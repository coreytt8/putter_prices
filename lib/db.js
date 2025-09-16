// lib/db.js
import { Pool } from "pg";

// Keep it tiny & safe for serverless
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // a small pool works well on serverless
  ssl: process.env.DATABASE_URL?.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined,
});

export const db = {
  query: (text, params) => pool.query(text, params),
};
