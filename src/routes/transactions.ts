import express, { Response } from 'express';
import { pool } from '../config/postgres';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest, DashboardStats } from '../types';

const router = express.Router();

type TransactionType = 'expense' | 'income';

interface TransactionRow {
    id: number;
    owner_user_id: string;
    from_user_id: string;
    to_user_id: string | null;
    second_party_id: string | null;
    amount: string | number;
    transaction_type: TransactionType;
    mode: string;
    source: string;
    tags: string[] | null;
    category: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

const normalizeTags = (value: unknown): string[] => {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value
            .map((tag) => String(tag).trim())
            .filter(Boolean);
    }

    return String(value)
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
};

const mapTransaction = (row: TransactionRow) => ({
    id: row.id,
    userId: row.owner_user_id,
    from: row.from_user_id,
    to: row.to_user_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    secondPartyId: row.second_party_id,
    amount: Number(row.amount),
    type: row.transaction_type,
    mode: row.mode,
    source: row.source,
    category: row.category,
    notes: row.notes,
    tags: row.tags || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    date: row.created_at
});

const loadTransactions = async ({
    userId,
    tags,
    match = 'any',
    startDate,
    endDate,
    page = 1,
    limit = 100
}: {
    userId: string;
    tags?: string[];
    match?: 'any' | 'all';
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
}) => {
    const conditions = ['owner_user_id = $1'];
    const values: Array<string | number | string[]> = [userId];
    let placeholderIndex = 2;

    if (startDate) {
        conditions.push(`created_at >= $${placeholderIndex}`);
        values.push(startDate);
        placeholderIndex += 1;
    }

    if (endDate) {
        conditions.push(`created_at <= $${placeholderIndex}`);
        values.push(endDate);
        placeholderIndex += 1;
    }

    if (tags && tags.length > 0) {
        conditions.push(`tags ${match === 'all' ? '@>' : '&&'} $${placeholderIndex}::text[]`);
        values.push(tags);
        placeholderIndex += 1;
    }

    const whereClause = conditions.join(' AND ');
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM transactions WHERE ${whereClause}`, values);

    const offset = (page - 1) * limit;
    const listValues = [...values, limit, offset];
    const transactionsResult = await pool.query<TransactionRow>(
        `
      SELECT *
      FROM transactions
      WHERE ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${placeholderIndex} OFFSET $${placeholderIndex + 1}
    `,
        listValues
    );

    return {
        total: countResult.rows[0]?.total || 0,
        transactions: transactionsResult.rows.map(mapTransaction)
    };
};

const parseDateTime = (value?: string, endOfDay = false): string | undefined => {
    if (!value) {
        return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }

    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    }

    return date.toISOString();
};

const upsertBudgetSpend = async (userId: string, category: string, amount: number, transactionDate: string): Promise<void> => {
    const month = transactionDate.slice(0, 7);
    const year = new Date(transactionDate).getFullYear();

    await pool.query(
        `
      INSERT INTO budgets (user_id, category, limit_amount, current_spent, month, year)
      VALUES ($1, $2, 0, $3, $4, $5)
      ON CONFLICT (user_id, category, month)
      DO UPDATE SET
        current_spent = budgets.current_spent + EXCLUDED.current_spent,
        year = EXCLUDED.year,
        updated_at = CURRENT_TIMESTAMP
    `,
        [userId, category, amount, month, year]
    );
};

// Get all transactions for current user
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const result = await loadTransactions({ userId: req.user!.id, limit: 100 });
        res.json(result.transactions);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

// Compatibility endpoint for paginated listing and date filtering
router.get('/transactions', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const page = parseInt((req.query.page as string) || '1', 10);
        const limit = parseInt((req.query.limit as string) || '10', 10);
        const startDate = parseDateTime(req.query.startDate as string);
        const endDate = parseDateTime(req.query.endDate as string, true);

        const result = await loadTransactions({
            userId: req.user!.id,
            startDate,
            endDate,
            page,
            limit
        });

        res.json({
            transactions: result.transactions,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(result.total / limit),
                totalItems: result.total,
                itemsPerPage: limit,
                hasNext: page < Math.ceil(result.total / limit),
                hasPrev: page > 1
            }
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

// Filter transactions by tags
router.get('/filter/tags', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const tags = normalizeTags(req.query.tags);
        const match = req.query.match === 'all' ? 'all' : 'any';

        const result = await loadTransactions({
            userId: req.user!.id,
            tags,
            match,
            page: 1,
            limit: 500
        });

        res.json({
            tags,
            match,
            transactions: result.transactions
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

// Create transaction
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const {
            amount,
            type,
            mode,
            source,
            tags = [],
            secondPartyId,
            category,
            notes,
            createdAt
        } = req.body;

        if (amount === undefined || amount === null || !type || !mode || !source) {
            res.status(400).json({ message: 'amount, type, mode, and source are required' });
            return;
        }

        if (type !== 'expense' && type !== 'income') {
            res.status(400).json({ message: 'type must be expense or income' });
            return;
        }

        const normalizedTags = normalizeTags(tags);
        const transactionDate = createdAt ? new Date(createdAt) : new Date();

        if (Number.isNaN(transactionDate.getTime())) {
            res.status(400).json({ message: 'createdAt must be a valid date' });
            return;
        }

        const userId = req.user!.id;
        const counterpartyId = secondPartyId ? String(secondPartyId) : null;

        if (!counterpartyId) {
            res.status(400).json({ message: 'secondPartyId is required to map the complement transaction' });
            return;
        }

        const fromUserId = type === 'expense' ? userId : counterpartyId;
        const toUserId = type === 'expense' ? counterpartyId : userId;

        const result = await pool.query<TransactionRow>(
            `
        INSERT INTO transactions (
          owner_user_id,
          from_user_id,
          to_user_id,
          second_party_id,
          amount,
          transaction_type,
          mode,
          source,
          tags,
          category,
          notes,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, CURRENT_TIMESTAMP)
        RETURNING *
      `,
            [
                userId,
                fromUserId,
                toUserId,
                counterpartyId,
                amount,
                type,
                mode,
                source,
                normalizedTags,
                category || null,
                notes || null,
                transactionDate.toISOString()
            ]
        );

        const transaction = mapTransaction(result.rows[0]);

        if (type === 'expense' && category) {
            await upsertBudgetSpend(userId, category, Number(amount), transactionDate.toISOString());
        }

        res.status(201).json(transaction);
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

// Update transaction
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const existing = await pool.query<TransactionRow>(
            'SELECT * FROM transactions WHERE id = $1 AND owner_user_id = $2 LIMIT 1',
            [req.params.id, req.user!.id]
        );

        if (!existing.rows[0]) {
            res.status(404).json({ message: 'Transaction not found' });
            return;
        }

        const current = existing.rows[0];
        const nextType: TransactionType = req.body.type || current.transaction_type;
        const nextSecondPartyId = req.body.secondPartyId ? String(req.body.secondPartyId) : current.second_party_id;
        const nextTags = req.body.tags !== undefined ? normalizeTags(req.body.tags) : current.tags || [];
        const nextCreatedAt = req.body.createdAt ? new Date(req.body.createdAt) : new Date(current.created_at);

        if (Number.isNaN(nextCreatedAt.getTime())) {
            res.status(400).json({ message: 'createdAt must be a valid date' });
            return;
        }

        const nextFromUserId = nextType === 'expense' ? req.user!.id : nextSecondPartyId;
        const nextToUserId = nextType === 'expense' ? nextSecondPartyId : req.user!.id;

        const updated = await pool.query<TransactionRow>(
            `
        UPDATE transactions
        SET
          amount = COALESCE($1, amount),
          transaction_type = COALESCE($2, transaction_type),
          mode = COALESCE($3, mode),
          source = COALESCE($4, source),
          tags = COALESCE($5::text[], tags),
          category = COALESCE($6, category),
          notes = COALESCE($7, notes),
          from_user_id = $8,
          to_user_id = $9,
          second_party_id = $10,
          created_at = $11,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12 AND owner_user_id = $13
        RETURNING *
      `,
            [
                req.body.amount ?? null,
                req.body.type ?? null,
                req.body.mode ?? null,
                req.body.source ?? null,
                req.body.tags !== undefined ? nextTags : null,
                req.body.category ?? null,
                req.body.notes ?? null,
                nextFromUserId,
                nextToUserId,
                nextSecondPartyId,
                nextCreatedAt.toISOString(),
                req.params.id,
                req.user!.id
            ]
        );

        if (!updated.rows[0]) {
            res.status(404).json({ message: 'Transaction not found' });
            return;
        }

        res.json(mapTransaction(updated.rows[0]));
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

// Delete transaction
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const deleted = await pool.query(
            'DELETE FROM transactions WHERE id = $1 AND owner_user_id = $2 RETURNING id',
            [req.params.id, req.user!.id]
        );

        if (!deleted.rows[0]) {
            res.status(404).json({ message: 'Transaction not found' });
            return;
        }

        res.json({ message: 'Transaction deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
});

// Dashboard data
router.get('/dashboard', authenticateToken, async (req: AuthRequest, res: Response<DashboardStats>): Promise<void> => {
    try {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const monthStart = new Date(`${currentMonth}-01T00:00:00.000Z`);
        const monthEnd = new Date(new Date(monthStart).getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);

        const { transactions } = await loadTransactions({
            userId: req.user!.id,
            startDate: monthStart.toISOString(),
            endDate: monthEnd.toISOString(),
            page: 1,
            limit: 1000
        });

        const expenses = transactions.filter((transaction) => transaction.type === 'expense');
        const income = transactions.filter((transaction) => transaction.type === 'income');

        const totalSpent = expenses.reduce((sum, transaction) => sum + transaction.amount, 0);
        const totalIncome = income.reduce((sum, transaction) => sum + transaction.amount, 0);
        const netAmount = totalIncome - totalSpent;

        const expenseCategoryTotals: Record<string, number> = {};
        const incomeCategoryTotals: Record<string, number> = {};
        const paymentMethodCounts: Record<string, number> = {};

        expenses.forEach((transaction) => {
            if (transaction.category) {
                expenseCategoryTotals[transaction.category] = (expenseCategoryTotals[transaction.category] || 0) + transaction.amount;
            }
            paymentMethodCounts[transaction.mode] = (paymentMethodCounts[transaction.mode] || 0) + 1;
        });

        income.forEach((transaction) => {
            if (transaction.category) {
                incomeCategoryTotals[transaction.category] = (incomeCategoryTotals[transaction.category] || 0) + transaction.amount;
            }
            paymentMethodCounts[transaction.mode] = (paymentMethodCounts[transaction.mode] || 0) + 1;
        });

        const topExpenseCategory = Object.keys(expenseCategoryTotals).length > 0
            ? Object.keys(expenseCategoryTotals).reduce((a, b) => (expenseCategoryTotals[a] > expenseCategoryTotals[b] ? a : b))
            : '';

        const topIncomeCategory = Object.keys(incomeCategoryTotals).length > 0
            ? Object.keys(incomeCategoryTotals).reduce((a, b) => (incomeCategoryTotals[a] > incomeCategoryTotals[b] ? a : b))
            : '';

        const topPaymentMethods = Object.keys(paymentMethodCounts)
            .sort((a, b) => paymentMethodCounts[b] - paymentMethodCounts[a])
            .slice(0, 5);

        const monthlyData = [];
        for (let i = 5; i >= 0; i -= 1) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            const monthStr = date.toISOString().slice(0, 7);
            const monthStartDate = new Date(`${monthStr}-01T00:00:00.000Z`);
            const monthEndDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

            const { transactions: monthTransactions } = await loadTransactions({
                userId: req.user!.id,
                startDate: monthStartDate.toISOString(),
                endDate: monthEndDate.toISOString(),
                page: 1,
                limit: 1000
            });

            const monthExpenses = monthTransactions.filter((transaction) => transaction.type === 'expense');
            const monthIncome = monthTransactions.filter((transaction) => transaction.type === 'income');

            const expenseAmount = monthExpenses.reduce((sum, transaction) => sum + transaction.amount, 0);
            const incomeAmount = monthIncome.reduce((sum, transaction) => sum + transaction.amount, 0);

            monthlyData.push({
                month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                expenses: expenseAmount,
                income: incomeAmount,
                net: incomeAmount - expenseAmount,
                amount: expenseAmount
            });
        }

        const transactionCounts = {
            totalTransactions: transactions.length,
            expenseCount: expenses.length,
            incomeCount: income.length
        };

        const averages = {
            avgExpense: expenses.length > 0 ? totalSpent / expenses.length : 0,
            avgIncome: income.length > 0 ? totalIncome / income.length : 0
        };

        const savingsRate = totalIncome > 0 ? ((totalIncome - totalSpent) / totalIncome) * 100 : 0;

        res.json({
            totalSpent,
            totalIncome,
            netAmount,
            savingsRate: Math.round(savingsRate * 100) / 100,
            topExpenseCategory,
            topIncomeCategory,
            expenseCategoryData: expenseCategoryTotals,
            incomeCategoryData: incomeCategoryTotals,
            topPaymentMethods,
            paymentMethodData: paymentMethodCounts,
            monthlyData,
            ...transactionCounts,
            ...averages,
            topCategory: topExpenseCategory,
            categoryData: expenseCategoryTotals
        });
    } catch (error: any) {
        console.error('Dashboard API Error:', error);
        res.status(500).json({ message: error.message } as any);
    }
});

export default router;
