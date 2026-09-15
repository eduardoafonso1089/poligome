/**
 * Render helper for the component layer of the test suite.
 *
 * These tests exist so that assertions about the interface are made against
 * what a component actually renders, instead of against the text of its source
 * file. A regex over source code breaks when someone reformats a line and stays
 * green when the behaviour it claims to protect is gone.
 *
 * react-dom/server runs hooks once and returns markup, which is enough to assert
 * structure, wiring and copy. Anything that needs a real pointer or a second
 * render belongs in the Playwright audits under scripts/.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Render a component to markup. Props are passed straight through. */
export function render(Component, props = {}) {
  return renderToStaticMarkup(React.createElement(Component, props));
}

/** A no-op that records nothing; use when a handler only has to exist. */
export const noop = () => undefined;

/** Build an object of no-op handlers for every name given. */
export function handlers(names) {
  return Object.fromEntries(names.map((name) => [name, noop]));
}

const ATTRIBUTE = (name, value) => new RegExp(`${name}="[^"]*\\b${escape(value)}\\b[^"]*"`);

function escape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count how many times an attribute carries exactly this value. */
export function countAttribute(markup, name, value) {
  return attributeValues(markup, name).filter((found) => found === String(value)).length;
}

/** Count elements whose class attribute contains this class token. */
export function countClass(markup, className) {
  return attributeValues(markup, "class").filter((value) => value.split(/\s+/).includes(className)).length;
}

/** Opening tags of every button, for accessibility and state assertions. */
export function buttons(markup) {
  return [...markup.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
}

/** The value of one attribute inside a single opening tag. */
export function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${escape(name)}="([^"]*)"`))?.[1] ?? null;
}

/** True when the markup carries `name="…value…"` as a whole word. */
export function hasAttribute(markup, name, value) {
  return ATTRIBUTE(name, value).test(markup);
}

/**
 * Every value of an attribute, in document order. The leading whitespace matters:
 * without it, asking for `d` also matches the tail of `data-annotation-id`.
 */
export function attributeValues(markup, name) {
  return [...markup.matchAll(new RegExp(`\\s${escape(name)}="([^"]*)"`, "g"))].map((match) => match[1]);
}

/** Attribute values with duplicates collapsed, in first-seen order. */
export function uniqueAttributeValues(markup, name) {
  return [...new Set(attributeValues(markup, name))];
}

/** Tag names of elements carrying a class, in document order. */
export function elementsWithClass(markup, className) {
  return [...markup.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\s[^>]*class="([^"]*)"/g)]
    .filter((match) => match[2].split(/\s+/).includes(className))
    .map((match) => match[1]);
}

/** Visible text with tags stripped, whitespace collapsed. */
export function text(markup) {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** The markup of every element whose opening tag matches, with its children. */
export function slice(markup, openingTagPattern) {
  const start = markup.search(openingTagPattern);
  if (start < 0) return "";
  return markup.slice(start);
}
