import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || supabaseServiceKey;
const supabaseDbUrl = process.env.SUPABASE_DB_URL;

if (!supabaseUrl || !supabaseServiceKey) {
  console.log(supabaseUrl);
  console.log(supabaseServiceKey);
  throw new Error('Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

if (!supabaseDbUrl) {
  throw new Error('Missing database environment variable: SUPABASE_DB_URL is required');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const authSupabase = createClient(supabaseUrl, supabaseAnonKey);



const POOL_MAX = parseInt(process.env.PG_POOL_MAX || '5', 10);
const POOL_IDLE_TIMEOUT_MS = parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10);

const pool = new Pool({
  connectionString: supabaseDbUrl,
  max: POOL_MAX,
  idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  ssl: {
    rejectUnauthorized: false
  }
});

let _firstConnectLogged = false;
pool.on('connect', () => {
  if (!_firstConnectLogged) {
    console.log('✅ Supabase PostgreSQL connected (pool active)');
    _firstConnectLogged = true;
  }
});

pool.on('error', (err) => {
  console.error('❌ Supabase PostgreSQL connection error:', err);
});

// Graceful shutdown for local development / process stops
const shutdownPool = async (): Promise<void> => {
  try {
    await pool.end();
    console.log('🛑 Supabase PostgreSQL pool has been closed');
  } catch (err) {
    console.error('❌ Error closing Supabase PostgreSQL pool:', err);
  }
};

process.on('SIGINT', shutdownPool);
process.on('SIGTERM', shutdownPool);

const initializeDatabase = async (): Promise<void> => {
  try {
    await pool.query('SELECT 1');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id BIGSERIAL PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT,
        second_party_id TEXT,
        amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('expense', 'income')),
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        tags TEXT[] NOT NULL DEFAULT '{}',
        category TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS transactions_owner_user_id_idx ON transactions (owner_user_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS transactions_created_at_idx ON transactions (created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS transactions_tags_idx ON transactions USING GIN (tags)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        limit_amount DECIMAL(12,2) NOT NULL CHECK (limit_amount >= 0),
        current_spent DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (current_spent >= 0),
        month TEXT NOT NULL,
        year INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category, month)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS monthly_reports (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        total_spent DECIMAL(10,2) NOT NULL,
        top_category VARCHAR(100),
        overbudget_categories JSON,
        category_breakdown JSON,
        payment_method_stats JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, month, year)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_summaries (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) UNIQUE NOT NULL,
        total_lifetime_spent DECIMAL(12,2) DEFAULT 0,
        most_used_category VARCHAR(100),
        most_used_payment_method VARCHAR(100),
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Supabase PostgreSQL tables initialized');
  } catch (error) {
    console.error('❌ Error initializing Supabase PostgreSQL tables:', error);
    const pgError = error as { code?: string };

    if (pgError?.code === '28P01') {
      console.error('🔐 Database authentication failed. Verify SUPABASE_DB_URL uses the exact URI from Supabase Database settings and the current DB password.');
      console.error('🧭 In Supabase: Project Settings -> Database -> Connection string -> URI (prefer Pooler URI). If password was changed, regenerate and replace the full URI.');
    }

    throw error;
  }
};

export { pool, supabase, authSupabase, initializeDatabase };