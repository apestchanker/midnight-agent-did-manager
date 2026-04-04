import { afterEach, describe, expect, it } from "vitest";

describe("server env loading", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPort = process.env.DID_API_PORT;

  afterEach(() => {
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;

    if (originalPort == null) delete process.env.DID_API_PORT;
    else process.env.DID_API_PORT = originalPort;
  });

  it("parses env files and preserves existing process env values", async () => {
    const { applyEnv, parseEnvFile } = await import("../server/load-env.js");

    process.env.DATABASE_URL = "postgresql://existing";
    delete process.env.DID_API_PORT;

    const parsed = parseEnvFile(`
      DATABASE_URL=postgresql://from-file
      DID_API_PORT=9999
    `);
    applyEnv(parsed);

    expect(process.env.DATABASE_URL).toBe("postgresql://existing");
    expect(process.env.DID_API_PORT).toBe("9999");
  });
});
