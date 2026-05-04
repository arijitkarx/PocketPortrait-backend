# Pocket Portrait - Backend

A backend service for a finance tracking application that provides APIs for Transaction management, budget tracking, and user authentication.

## Features

- Supabase auth and OAuth
- Transaction tracking and management on PostgreSQL
- Budget creation and monitoring
- Dashboard analytics and reports
- Supabase PostgreSQL for all data
- RESTful API endpoints

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Supabase account for PostgreSQL and auth

## Installation

1. Clone the repository:

```bash
git clone https://github.com/DemonicAK/PocketPortrait-backend.git
cd PocketPortrait-backend
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
cp .env.example .env
```

4. Configure your `.env` file with:

```
PORT=5000
NODE_ENV=development

# PostgreSQL (Supabase)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_key
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_DB_URL=your_supabase_db_connection_string

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000
```

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Type Checking

```bash
npm run type-check
```

## API Endpoints

### Authentication

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login

### Transactions

- `GET /api/transactions` - Get all Transactions for user
<!-- - `GET /api/transactions/transactions` - Get paginated Transactions with filters -->
- `POST /api/transactions` - Create new Transaction
- `PUT /api/transactions/:id` - Update Transaction
- `DELETE /api/transactions/:id` - Delete Transaction
- `GET /api/transactions/dashboard` - Get dashboard statistics

### Budgets

- `GET /api/budgets` - Get budgets for current month
- `POST /api/budgets` - Create or update budget
- `GET /api/budgets/alerts` - Get budget alerts

### Health Check

- `GET /health` - Server health status

## Database Schema

### PostgreSQL Tables (Supabase)

- **profiles**: User profile data mirrored from Supabase auth
- **transactions**: Transaction records
- **budgets**: Budget limits and tracking
- **monthly_reports**: Aggregated monthly data
- **user_summaries**: User lifetime statistics

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── postgres.ts
│   ├── middleware/
│   │   └── auth.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── transactions.ts
│   │   └── budgets.ts
│   ├── types/
│   │   └── index.ts
│   └── server.ts
├── .env
├── package.json
├── tsconfig.json
└── README.md
```

## Available Categories

- Food
- Rent
- Shopping
- Transport
- Entertainment
- Healthcare
- Other

## Payment Methods

- UPI
- Credit Card
- Debit Card
- Cash
- Net Banking

## Development

### Running the Server

The server will start on the port specified in your `.env` file (default: 5000).

### Database Connections

The application connects to Supabase PostgreSQL on startup and creates the required tables if they do not already exist.

### Authentication

All protected routes require a Supabase access token in a cookie or Bearer token in the Authorization header:

```
Authorization: Bearer <your-access-token>
```

OAuth login is available through `GET /api/auth/oauth/:provider`.

## Environment Setup

1. **Supabase**: Create a new Supabase project for PostgreSQL and auth
2. **Supabase keys**: Add your anon key, service role key, and database URL
3. **CORS**: Ensure your frontend URL is set in the `.env` file for CORS configuration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test your changes
5. Submit a pull request

## License

This project is licensed under the MIT License.
