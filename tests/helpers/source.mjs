/**
 * Formatting-insensitive access to source files.
 *
 * A handful of contracts cannot be reached by rendering: a `useEffect` that
 * only runs in a real browser, a listener registered with `{ passive: false }`,
 * the order of two statements inside a closure. Those are still asserted
 * against the source, but never against its *formatting*.
 *
 * Every assertion of that kind goes through `sourceOf`, which collapses runs of
 * whitespace into a single space. A regex written on one line therefore still
 * matches after the file is wrapped, indented or run through a formatter, which
 * is what used to make the suite block any reformatting of the two largest
 * files in the editor.
 *
 * tests/architecture-guards.test.mjs checks that no test bypasses this helper.
 */
import { readFileSync } from "node:fs";

const cache = new Map();

/** The file at a repository-relative path, with every whitespace run collapsed. */
export function sourceOf(path) {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  const normalized = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\s+/g, " ");
  cache.set(path, normalized);
  return normalized;
}

/**
 * The slice of a file between two markers, for assertions that must hold inside
 * one function rather than anywhere in the file.
 */
export function region(path, from, to) {
  const source = sourceOf(path);
  const start = source.indexOf(from);
  if (start < 0) throw new Error(`region start not found in ${path}: ${from}`);
  const end = to ? source.indexOf(to, start + from.length) : -1;
  return source.slice(start, end < 0 ? undefined : end);
}

/** How many lines a file has, for the rare assertion about a file's size. */
export function lineCount(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").split("\n").length;
}

/** The body of a CSS rule, by selector, from a normalized stylesheet. */
export function cssRule(path, selector) {
  const source = sourceOf(path);
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`CSS rule not found in ${path}: ${selector}`);
  return source.slice(start, source.indexOf("}", start) + 1);
}
