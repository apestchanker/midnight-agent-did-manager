import "./load-env.js";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/agent_registry_db";

export const pool = new Pool({
  connectionString: DATABASE_URL,
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
