import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Function to initialize the database with schema
export const initDatabase = async (): Promise<void> => {
  try {
    // Read the SQL file
    const sqlFilePath = path.join(__dirname, 'database.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf8');

    // Connect to database and execute SQL
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('Database initialized successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error initializing database:', err);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to initialize database:', err);
    throw err;
  }
};

// Helper function for queries
export const query = async (text: string, params: any[] = []): Promise<any> => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('Error executing query', { text, error: err });
    throw err;
  }
};

// Test database connection
export const testConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    client.release();
    console.log('Database connection successful');
    return true;
  } catch (err) {
    console.error('Database connection error:', err);
    return false;
  }
};

export default {
  pool,
  query,
  initDatabase,
  testConnection
}; 