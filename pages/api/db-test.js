import { getSql } from '@/lib/db';

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const rows = await sql`select now() as server_time`;
    res.status(200).json({ ok: true, time: rows[0].server_time });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
