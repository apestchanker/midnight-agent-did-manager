import { describe, expect, it } from "vitest";
import { appendLog, getRecentLogs } from "../server/log-store.js";

describe("log-store", () => {
  it("stores recent log entries with bounded retrieval", () => {
    appendLog("info", "test", ["first message"]);
    appendLog("error", "test", ["second message"]);

    const entries = getRecentLogs(2);
    expect(entries).toHaveLength(2);
    expect(entries[0].scope).toBe("test");
    expect(entries[0].message).toContain("first message");
    expect(entries[1].level).toBe("error");
    expect(entries[1].message).toContain("second message");
  });
});
