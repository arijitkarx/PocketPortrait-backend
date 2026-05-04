import express, { Response } from 'express';
import { pool } from '../config/postgres';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = express.Router();

interface BudgetRow {
    id: number;
    user_id: string;
    category: string;
    limit_amount: string | number;
    current_spent: string | number;
    month: string;
    year: number;
    created_at: string;
    updated_at: string;
}

const currentMonthKey = (): string => new Date().toISOString().slice(0, 7);

const mapBudget = (row: BudgetRow) => ({
    id: row.id,
    userId: row.user_id,
    category: row.category,
    limitAmount: Number(row.limit_amount),
    currentSpent: Number(row.current_spent),
    month: row.month,
    year: row.year,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

// Get budgets for current month
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const month = currentMonthKey();
        const result = await pool.query<BudgetRow>(
            `
        SELECT *
        FROM budgets
        WHERE user_id = $1 AND month = $2
        ORDER BY category ASC
      `,
            [req.user!.id, month]
        );

        res.json(result.rows.map(mapBudget));
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

// Create or update budget
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { category, limitAmount } = req.body;
        const month = currentMonthKey();
        const year = new Date().getFullYear();

        if (!category || limitAmount === undefined || limitAmount === null) {
            res.status(400).json({ message: 'category and limitAmount are required' });
            return;
        }

        const result = await pool.query<BudgetRow>(
            `
        INSERT INTO budgets (user_id, category, limit_amount, current_spent, month, year)
        VALUES ($1, $2, $3, 0, $4, $5)
        ON CONFLICT (user_id, category, month)
        DO UPDATE SET
          limit_amount = EXCLUDED.limit_amount,
          year = EXCLUDED.year,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
            [req.user!.id, category, limitAmount, month, year]
        );

        res.json(mapBudget(result.rows[0]));
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

// Get budget alerts
router.get('/alerts', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const month = currentMonthKey();
        const budgetsResult = await pool.query<BudgetRow>(
            `
        SELECT *
        FROM budgets
        WHERE user_id = $1 AND month = $2
      `,
            [req.user!.id, month]
        );

        const spendResult = await pool.query<{ category: string; spent: string | number }>(
            `
        SELECT category, COALESCE(SUM(amount), 0) AS spent
        FROM transactions
        WHERE owner_user_id = $1
          AND transaction_type = 'expense'
          AND created_at >= $2::timestamp
          AND created_at <= $3::timestamp
        GROUP BY category
      `,
            [
                req.user!.id,
                `${month}-01T00:00:00.000Z`,
                new Date(new Date(`${month}-01T00:00:00.000Z`).getFullYear(), new Date(`${month}-01T00:00:00.000Z`).getMonth() + 1, 0, 23, 59, 59, 999).toISOString()
            ]
        );

        const spentByCategory = spendResult.rows.reduce<Record<string, number>>((accumulator, row) => {
            accumulator[row.category] = Number(row.spent);
            return accumulator;
        }, {});

        const alerts = budgetsResult.rows
            .map((budget) => {
                const spent = spentByCategory[budget.category] || Number(budget.current_spent);
                const limit = Number(budget.limit_amount);
                const percentage = limit > 0 ? (spent / limit) * 100 : 0;

                return {
                    category: budget.category,
                    percentage: Math.round(percentage),
                    spent,
                    limit,
                    severity: spent >= limit ? 'high' : 'medium'
                };
            })
            .filter((alert) => alert.percentage >= 80);

        res.json(alerts);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
