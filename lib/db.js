import { neon } from '@neondatabase/serverless';

let sql;
export function getSql() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}
