import express, { Request, Response } from 'express';
import { authSupabase, pool } from '../config/postgres';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest, AuthResponse } from '../types';

const router = express.Router();

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? ('none' as const) : ('lax' as const),
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined
};

const publicCookieOptions = {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? ('none' as const) : ('lax' as const),
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined
};

const saveProfile = async (userId: string, email: string, username?: string): Promise<void> => {
    await pool.query(
        `
      INSERT INTO profiles (id, email, username, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (id)
      DO UPDATE SET
        email = EXCLUDED.email,
        username = COALESCE(EXCLUDED.username, profiles.username),
        updated_at = CURRENT_TIMESTAMP
    `,
        [userId, email, username || null]
    );
};

const setAuthCookies = (res: Response, token: string, refreshToken?: string): void => {
    res.cookie('authToken', token, cookieOptions);
    if (refreshToken) {
        res.cookie('refreshToken', refreshToken, cookieOptions);
    }
    res.cookie('isLoggedIn', 'true', publicCookieOptions);
};

router.post('/register', async (req: Request, res: Response<AuthResponse>): Promise<void> => {
    try {
        const { email, username, password } = (req.body || {}) as {
            email?: string;
            username?: string;
            password?: string;
        };

        if (!email || !password) {
            res.status(400).json({ message: 'Email and password are required' } as any);
            return;
        }

        const { data, error } = await authSupabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username: username || ''
                }
            }
        });

        if (error || !data.user) {
            res.status(400).json({ message: error?.message || 'Failed to register user' } as any);
            return;
        }

        await saveProfile(data.user.id, data.user.email || email, username);

        if (data.session) {
            setAuthCookies(res, data.session.access_token, data.session.refresh_token);
        }

        res.status(201).json({
            token: data.session?.access_token || '',
            refreshToken: data.session?.refresh_token,
            user: {
                id: data.user.id,
                email: data.user.email || email,
                username: username || (data.user.user_metadata as any)?.username || ''
            }
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message } as any);
    }
});

router.post('/login', async (req: Request, res: Response<AuthResponse>): Promise<void> => {
    try {
        const { email, password } = (req.body || {}) as {
            email?: string;
            password?: string;
        };

        if (!email || !password) {
            res.status(400).json({ message: 'Email and password are required' } as any);
            return;
        }

        const { data, error } = await authSupabase.auth.signInWithPassword({
            email,
            password
        });

        if (error || !data.user || !data.session) {
            res.status(401).json({ message: error?.message || 'Invalid credentials' } as any);
            return;
        }

        const profile = await pool.query(
            'SELECT username FROM profiles WHERE id = $1 LIMIT 1',
            [data.user.id]
        );

        const username = profile.rows[0]?.username || (data.user.user_metadata as any)?.username || '';

        await saveProfile(data.user.id, data.user.email || email, username);
        setAuthCookies(res, data.session.access_token, data.session.refresh_token);

        res.json({
            token: data.session.access_token,
            refreshToken: data.session.refresh_token,
            user: {
                id: data.user.id,
                email: data.user.email || email,
                username
            }
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message } as any);
    }
});

router.get('/oauth/:provider', async (req: Request, res: Response): Promise<void> => {
    try {
        const provider = req.params.provider as 'google' | 'github' | 'facebook' | 'apple' | 'discord';
        const redirectTo = (req.query.redirectTo as string) || process.env.OAUTH_REDIRECT_TO || process.env.FRONTEND_URL || '';

        const { data, error } = await authSupabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: redirectTo || undefined
            }
        });

        if (error || !data.url) {
            res.status(400).json({ message: error?.message || 'Failed to create OAuth URL' });
            return;
        }

        res.json({ url: data.url } as any);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

router.post('/logout', (req: Request, res: Response): void => {
    res.clearCookie('authToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('isLoggedIn', publicCookieOptions);
    res.json({ message: 'Logged out successfully' });
});

router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (!req.user) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const profile = await pool.query(
            'SELECT username FROM profiles WHERE id = $1 LIMIT 1',
            [req.user.id]
        );

        res.json({
            user: {
                id: req.user.id,
                email: req.user.email || '',
                username: profile.rows[0]?.username || req.user.username || ''
            }
        } as any);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
