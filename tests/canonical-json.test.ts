import { describe, expect, it } from "vitest";
import { canonicalize } from "../lib/canonical-json.js";

describe("canonicalize", () => {
  it("sorts object keys in ascending lexicographic order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array element order", () => {
    expect(canonicalize({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it("sorts keys recursively in nested objects", () => {
    expect(canonicalize({ a: { z: 1, m: 2 } })).toBe('{"a":{"m":2,"z":1}}');
  });

  it("handles deeply nested objects", () => {
    expect(canonicalize({ z: { b: { d: 1, c: 2 }, a: 3 }, y: 0 })).toBe(
      '{"y":0,"z":{"a":3,"b":{"c":2,"d":1}}}',
    );
  });

  it("handles primitive values — number", () => {
    expect(canonicalize(42)).toBe("42");
  });

  it("handles primitive values — string", () => {
    expect(canonicalize("hello")).toBe('"hello"');
  });

  it("handles primitive values — boolean", () => {
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
  });

  it("handles null", () => {
    expect(canonicalize(null)).toBe("null");
  });

  it("handles arrays at top level", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("sorts Unicode keys correctly (UTF-16 code unit order)", () => {
    // Uppercase letters come before lowercase in UTF-16 (A=65, a=97)
    expect(canonicalize({ b: 1, A: 2 })).toBe('{"A":2,"b":1}');
    // Unicode characters
    expect(canonicalize({ é: 1, a: 2 })).toBe('{"a":2,"é":1}');
  });

  it("handles empty object", () => {
    expect(canonicalize({})).toBe("{}");
  });

  it("handles empty array", () => {
    expect(canonicalize([])).toBe("[]");
  });

  it("handles arrays of objects — sorts keys inside each element", () => {
    expect(canonicalize([{ b: 1, a: 2 }, { d: 3, c: 4 }])).toBe(
      '[{"a":2,"b":1},{"c":4,"d":3}]',
    );
  });

  it("round-trip property: canonicalize(JSON.parse(canonicalize(x))) === canonicalize(x)", () => {
    const x = { z: { b: 2, a: 1 }, m: [3, 1, 2], c: "hello" };
    const first = canonicalize(x);
    const second = canonicalize(JSON.parse(first));
    expect(second).toBe(first);
  });

  it("produces no whitespace in output", () => {
    const result = canonicalize({ a: 1, b: 2 });
    expect(result).not.toMatch(/\s/);
  });
});
