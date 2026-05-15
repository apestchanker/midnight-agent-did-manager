/**
 * canonical-json.js — deterministic JSON canonicalization
 *
 * Algorithm:
 *   1. Recursively sort object keys in ascending lexicographic order
 *      (UTF-16 code unit order, matching Array.prototype.sort default).
 *   2. Apply recursively to all nested objects; arrays preserve element order.
 *   3. Serialize with JSON.stringify(sorted, null, 0) — no whitespace, no newline.
 *
 * No external dependencies.
 *
 * @param {unknown} value
 * @returns {string} — deterministic JSON with sorted keys, no whitespace
 */
export function canonicalize(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}
