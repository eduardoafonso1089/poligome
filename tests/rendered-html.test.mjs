import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";

/**
 * This is the build tier: it asserts on the artifact `vinext build` produces.
 * `npm run test:unit` is meant to be fast and buildless, so the test announces
 * itself as skipped there instead of failing. CI runs it after the build, via
 * `npm run test:build`, where the artifact is always present.
 */
const built = await access(new URL("../dist/server/index.js", import.meta.url)).then(() => true, () => false);

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", { skip: built ? false : "run npm run build first (covered by npm run test:build in CI)" }, async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /<title>Poligome — Anotação de Imagens<\/title>/);
  assert.doesNotMatch(html, /visionlabel|\/workspace\/sites\//i);
  const fontUrls = [...html.matchAll(/<link[^>]*href="([^"]+)"[^>]*as="font"/g)].map(match => match[1]);
  assert.ok(fontUrls.length > 0, "self-hosted fonts must be preloaded");
  for (const url of fontUrls) {
    assert.ok(url.startsWith("/assets/_vinext_fonts/"), `font must use a public URL: ${url}`);
    await access(new URL(`../dist/client${url}`, import.meta.url));
  }

  const themeScript = html.indexOf('localStorage.getItem("poligome-theme")');
  const body = html.indexOf("<body");
  assert.notEqual(themeScript, -1, "the initial theme script must be rendered");
  assert.ok(themeScript < body, "the saved theme must be applied before the body is painted");
  assert.match(html, /href=["']\/annotate\?demo=1["']/, "the landing page must expose the browser demo");
});
