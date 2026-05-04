import { Request, Response, NextFunction } from 'express';
import { authSupabase } from '../config/postgres';
import { AuthRequest } from '../types';

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cookieToken = req.cookies?.authToken;
    const bearerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;
    const token = cookieToken || bearerToken;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      res.status(401).json({ message: 'Access denied. No token provided.' });
      return;
    }

    const { data, error } = await authSupabase.auth.getUser(token);

    if (error || !data.user) {
      res.status(403).json({ message: 'Invalid token' });
      return;
    }

    req.user = {
      id: data.user.id,
      email: data.user.email || undefined,
      username: (data.user.user_metadata as any)?.username || undefined,
      user_metadata: data.user.user_metadata,
      app_metadata: data.user.app_metadata
    };

    next();
  } catch (error) {
    res.status(500).json({ message: 'Authentication failed' });
  }
};