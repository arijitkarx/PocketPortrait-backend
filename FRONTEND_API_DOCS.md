# PocketPortrait Backend API Docs (Frontend)

## Base URL

- Local: `http://localhost:5000`
- API prefix: `/api`

## Auth Model

Protected endpoints require a valid Supabase access token.

You can send the token in either way:

1. `Authorization: Bearer <access_token>` header
2. `authToken` cookie (set by login/register)

## Common Response Patterns

### Success

- `200 OK` for reads/updates/deletes
- `201 Created` for resource creation

### Error

Most errors return:

```json
{
  "message": "Human-readable error message"
}
```

Common status codes:

- `400` bad input
- `401` missing auth
- `403` invalid/expired token
- `404` not found
- `500` server/db errors

---

## Health

### GET /health

Check server liveness.

Response:

```json
{
  "status": "OK",
  "timestamp": "2026-05-01T09:00:00.000Z"
}
```

---

## Auth Endpoints

### POST /api/auth/register

Create a new user with Supabase auth and upsert profile row.

Request body:

```json
{
  "email": "user@example.com",
  "password": "Test@12345",
  "username": "optional_username"
}
```

Notes:

- `email` and `password` are required.
- `username` is optional.
- Depending on Supabase auth settings, `token` can be empty if no session is created immediately.

Success response (`201`):

```json
{
  "token": "access_token_or_empty_string",
  "refreshToken": "refresh_token_if_present",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "optional_username"
  }
}
```

### POST /api/auth/login

Login with email/password.

Request body:

```json
{
  "email": "user@example.com",
  "password": "Test@12345"
}
```

Success response (`200`):

```json
{
  "token": "access_token",
  "refreshToken": "refresh_token",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "stored_username"
  }
}
```

### GET /api/auth/oauth/:provider

Get OAuth redirect URL.

Path param:

- `provider`: one of `google | github | facebook | apple | discord`

Query params:

- `redirectTo` (optional): callback/redirect URL

Success response (`200`):

```json
{
  "url": "https://..."
}
```

### POST /api/auth/logout

Clears auth cookies.

Success response (`200`):

```json
{
  "message": "Logged out successfully"
}
```

### GET /api/auth/me

Get authenticated user profile snapshot.

Auth required: yes

Success response (`200`):

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "stored_username"
  }
}
```

---

## Transaction Endpoints

Transaction object shape returned by API:

```json
{
  "id": 1,
  "userId": "owner_user_id",
  "from": "from_user_id",
  "to": "to_user_id_or_null",
  "fromUserId": "from_user_id",
  "toUserId": "to_user_id_or_null",
  "secondPartyId": "counterparty_or_null",
  "amount": 499.99,
  "type": "expense",
  "mode": "UPI",
  "source": "manual",
  "category": "Food",
  "notes": "optional",
  "tags": ["lunch", "office"],
  "createdAt": "2026-05-01T09:00:00.000Z",
  "updatedAt": "2026-05-01T09:00:00.000Z",
  "date": "2026-05-01T09:00:00.000Z"
}
```

### GET /api/transactions

Get latest transactions for current user (up to 100).

Auth required: yes

Response (`200`):

```json
[
  {
    "id": 1,
    "amount": 499.99,
    "type": "expense"
  }
]
```

### GET /api/transactions/transactions

Paginated list + optional date filtering.

Auth required: yes

Query params:

- `page` (default `1`)
- `limit` (default `10`)
- `startDate` (optional, any JS-parseable date)
- `endDate` (optional, any JS-parseable date; server normalizes to end-of-day)

Response (`200`):

```json
{
  "transactions": [],
  "pagination": {
    "currentPage": 1,
    "totalPages": 0,
    "totalItems": 0,
    "itemsPerPage": 10,
    "hasNext": false,
    "hasPrev": false
  }
}
```

### GET /api/transactions/filter/tags

Filter transactions by tags.

Auth required: yes

Query params:

- `tags` required for meaningful filtering
  - supports comma-separated string, for example `tags=food,office`
- `match` optional: `any` (default) or `all`

Response (`200`):

```json
{
  "tags": ["food", "office"],
  "match": "all",
  "transactions": []
}
```

### POST /api/transactions

Create transaction.

Auth required: yes

Request body:

```json
{
  "amount": 499.99,
  "type": "expense",
  "mode": "UPI",
  "source": "manual",
  "secondPartyId": "merchant-001",
  "tags": ["lunch", "office"],
  "category": "Food",
  "notes": "Team lunch",
  "createdAt": "2026-05-01T09:00:00.000Z"
}
```

Validation rules:

- required: `amount`, `type`, `mode`, `source`, `secondPartyId`
- `type` must be `expense` or `income`
- `createdAt` must be valid date if provided

Response (`201`): transaction object (same shape as above).

### PUT /api/transactions/:id

Update transaction (partial update).

Auth required: yes

Path params:

- `id` (transaction id)

Request body (all optional):

```json
{
  "amount": 550,
  "type": "expense",
  "mode": "Card",
  "source": "manual",
  "secondPartyId": "merchant-002",
  "tags": ["client"],
  "category": "Food",
  "notes": "Updated note",
  "createdAt": "2026-05-01T09:30:00.000Z"
}
```

Response (`200`): updated transaction object.

Possible errors:

- `404` if transaction does not exist or not owned by user
- `400` if `createdAt` invalid

### DELETE /api/transactions/:id

Delete transaction.

Auth required: yes

Path params:

- `id` (transaction id)

Response (`200`):

```json
{
  "message": "Transaction deleted successfully"
}
```

### GET /api/transactions/dashboard

Aggregated dashboard stats for current month + 6-month trend.

Auth required: yes

Response (`200`):

```json
{
  "totalSpent": 12000,
  "totalIncome": 35000,
  "netAmount": 23000,
  "savingsRate": 65.71,
  "topCategory": "Food",
  "topExpenseCategory": "Food",
  "topIncomeCategory": "Salary",
  "categoryData": { "Food": 6000 },
  "expenseCategoryData": { "Food": 6000 },
  "incomeCategoryData": { "Salary": 35000 },
  "topPaymentMethods": ["UPI", "Card"],
  "paymentMethodData": { "UPI": 8, "Card": 3 },
  "monthlyData": [
    {
      "month": "Jan 2026",
      "amount": 5000,
      "expenses": 5000,
      "income": 20000,
      "net": 15000
    }
  ],
  "totalTransactions": 11,
  "expenseCount": 8,
  "incomeCount": 3,
  "avgExpense": 625,
  "avgIncome": 11666.67
}
```

---

## Budget Endpoints

Budget object shape returned by API:

```json
{
  "id": 1,
  "userId": "uuid",
  "category": "Food",
  "limitAmount": 5000,
  "currentSpent": 1200,
  "month": "2026-05",
  "year": 2026,
  "createdAt": "2026-05-01T09:00:00.000Z",
  "updatedAt": "2026-05-01T09:00:00.000Z"
}
```

### GET /api/budgets

Get budgets for current month.

Auth required: yes

Response (`200`):

```json
[]
```

### POST /api/budgets

Create or update budget for current month/category.

Auth required: yes

Request body:

```json
{
  "category": "Food",
  "limitAmount": 5000
}
```

Validation rules:

- required: `category`, `limitAmount`

Response (`200`): budget object.

### GET /api/budgets/alerts

Get budget alerts for categories crossing 80% spend.

Auth required: yes

Response (`200`):

```json
[
  {
    "category": "Food",
    "percentage": 92,
    "spent": 4600,
    "limit": 5000,
    "severity": "medium"
  }
]
```

Severity behavior:

- `high` when spent >= limit
- `medium` when percentage >= 80 and spent < limit

---

## Frontend Integration Notes

- Always handle `message` in non-2xx responses and show a user-friendly fallback.
- Prefer header-based auth (`Authorization: Bearer <token>`) for mobile/web clients unless cookie flow is intentional.
- Keep token refresh strategy on frontend if session expiration is expected.
- For transaction creation/update, keep `secondPartyId` in your form model.
- For tags filter, send comma-separated values in query for simplicity.
