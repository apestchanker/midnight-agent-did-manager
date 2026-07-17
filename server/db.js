import "./load-env.js";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/agent_registry_db";

// Supabase (and most managed Postgres hosts) require TLS; local/LAN Postgres
// instances used in dev typically don't have it configured at all, so only
// request SSL when the connection target is a managed host that needs it.
const requiresSsl = /supabase\.(co|com)/.test(DATABASE_URL);

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: requiresSsl ? { rejectUnauthorized: false } : false,
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function withTransaction(run) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase() {
  const schemaPath = resolve(process.cwd(), "server", "schema.sql");
  const sql = await readFile(schemaPath, "utf8");
  await pool.query(sql);
}

export function getDatabaseUrl() {
  return DATABASE_URL;
}
