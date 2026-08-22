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

// node-postgres emits 'error' on the Pool when a *checked-in* (idle) client
// fails — a `docker stop` on the database, a managed-host failover, an idle
// timeout server-side. Errors on a client that's currently checked out reject
// the in-flight query instead and never reach here, so there's no route
// handler in a position to catch this one. Without a listener, the process
// dies on an unhandled 'error' event the moment the database goes away, even
// though the API was sitting idle and had nothing in flight.
//
// The pool discards the broken client on its own and dials a fresh one for
// the next query, so logging and staying up is enough to recover once the
// database is back — this deliberately does not tear down the pool or exit.
// Note that initializeDatabaseWithRetry() in index.js only guards *startup*:
// it applies schema.sql before the listener binds, and mid-run reconnection
// needs no equivalent because the schema is already applied and the pool
// re-dials lazily.
//
// The error is logged as message + code rather than as the object: pg attaches
// the failed `client` (and its resolved connection parameters, including user
// and host) to these errors, and console.error is teed into the in-memory log
// buffer that /api/logs serves.
pool.on("error", (error) => {
  const code =
    error && typeof error === "object" && error.code ? error.code : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[did-api] idle postgres client error (${code}): ${message};` +
      " pool will reconnect on next query",
  );
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
