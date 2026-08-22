import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Covers the pool-level error listener in server/db.js.
//
// node-postgres emits 'error' on the Pool for failures on *idle* clients, and
// an EventEmitter 'error' with no listener throws — so a database that goes
// away while the API sits idle (docker stop, managed-host failover) used to
// take the whole process down with an unhandled 'error' event.
//
// Unlike the other server tests, this one mocks `pg` rather than
// ../server/db.js, since db.js's pool construction is the thing under test.
// The fake Pool is a real EventEmitter, so `emit("error", ...)` throws exactly
// the way pg's would when nothing is listening.

const constructed: FakePool[] = [];

class FakePool extends EventEmitter {
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
    constructed.push(this);
  }

  query = vi.fn(async () => ({ rows: [] }));
  connect = vi.fn();
  end = vi.fn(async () => {});
}

vi.mock("pg", () => ({ Pool: FakePool }));

vi.mock("../server/load-env.js", () => ({}));

async function loadPool() {
  constructed.length = 0;
  vi.resetModules();
  const mod = await import("../server/db.js");
  return mod.pool as unknown as FakePool;
}

describe("database pool error handling", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("registers an error listener so an idle-client failure cannot crash the process", async () => {
    const pool = await loadPool();

    expect(pool.listenerCount("error")).toBeGreaterThan(0);

    // The regression this guards: with no listener, EventEmitter rethrows and
    // the process dies on `docker stop postgres` while the server is idle.
    const idleError = Object.assign(
      new Error("terminating connection due to administrator command"),
      { code: "57P01" },
    );

    expect(() => pool.emit("error", idleError, {})).not.toThrow();
  });

  it("logs the idle-client failure with the [did-api] prefix, code and message", async () => {
    const pool = await loadPool();

    pool.emit(
      "error",
      Object.assign(new Error("terminating connection due to administrator command"), {
        code: "57P01",
      }),
      {},
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain("[did-api]");
    expect(logged).toContain("57P01");
    expect(logged).toContain("terminating connection due to administrator command");
  });

  it("logs a single string rather than the error object, which carries connection params", async () => {
    const pool = await loadPool();

    // pg attaches the failed `client` — including its resolved user/host — to
    // these errors, and console.error is teed into the in-memory buffer that
    // /api/logs serves, so the handler must not hand over the whole object.
    const idleError = Object.assign(new Error("connection terminated"), {
      code: "57P01",
      client: { connectionParameters: { user: "postgres", host: "db.internal" } },
    });

    pool.emit("error", idleError, {});

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [first, ...rest] = errorSpy.mock.calls[0];
    expect(typeof first).toBe("string");
    expect(rest).toHaveLength(0);
    expect(first).not.toContain("db.internal");
  });

  it("keeps the pool usable after an idle-client error, so it reconnects lazily", async () => {
    const pool = await loadPool();

    pool.emit("error", Object.assign(new Error("connection terminated"), { code: "57P01" }), {});

    // The handler must not call pool.end() — pg discards the broken client on
    // its own and dials a fresh one for the next query.
    expect(pool.end).not.toHaveBeenCalled();

    const { query } = await import("../server/db.js");
    await expect(query("select 1")).resolves.toEqual({ rows: [] });
    expect(pool.query).toHaveBeenCalledWith("select 1", []);
  });

  it("handles a non-Error emitted value without throwing", async () => {
    const pool = await loadPool();

    expect(() => pool.emit("error", "socket hang up", {})).not.toThrow();
    expect(String(errorSpy.mock.calls[0][0])).toContain("socket hang up");
  });
});
