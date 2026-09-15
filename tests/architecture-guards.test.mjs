/**
 * Proves the architecture boundaries are enforced.
 *
 * These used to be `assert.ok(!source.includes(token))` over a file read. They
 * are lint rules now (see eslint.config.mjs), which is the right home — but a
 * rule nobody ever violates is indistinguishable from a rule that does not work.
 * So this suite feeds ESLint code that breaks each boundary on purpose and
 * checks that it is reported, then feeds it the legitimate shape and checks that
 * it is not.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });

async function lint(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result.messages;
}

const rulesFired = (messages) => messages.map((message) => message.ruleId);

test("presentation cannot import editor state or interaction hooks", async () => {
  const offending = await lint(
    "app/editor/presentation/offender.tsx",
    `import { useEditorState } from "../state/use-editor-state";\nexport const a = useEditorState;\n`,
  );
  assert.ok(
    rulesFired(offending).includes("@typescript-eslint/no-restricted-imports"),
    `expected the boundary to fire, got: ${JSON.stringify(rulesFired(offending))}`,
  );
});

test("presentation may still import a shared type from a hook module", async () => {
  // A type import leaves no runtime dependency, and DrawingTool genuinely lives there.
  const allowed = await lint(
    "app/editor/presentation/allowed.tsx",
    `import type { DrawingTool } from "../drawing/use-drawing-interactions";\nexport type A = DrawingTool;\n`,
  );
  assert.ok(!rulesFired(allowed).includes("@typescript-eslint/no-restricted-imports"));
});

test("presentation cannot reach into session IO or vector geometry", async () => {
  for (const specifier of ["../session/editor-session-io", "../geometry/vector-operations"]) {
    const messages = await lint(
      "app/editor/panels/offender.tsx",
      `import { thing } from "${specifier}";\nexport const a = thing;\n`,
    );
    assert.ok(
      rulesFired(messages).includes("@typescript-eslint/no-restricted-imports"),
      `${specifier} should be blocked from presentation`,
    );
  }
});

test("pure models cannot import React or touch the DOM", async () => {
  const reactImport = await lint(
    "app/editor/models/offender.ts",
    `import { useState } from "react";\nexport const a = useState;\n`,
  );
  assert.ok(rulesFired(reactImport).includes("no-restricted-imports"));

  const domAccess = await lint(
    "app/editor/geometry/offender.ts",
    `export function a() { return window.innerWidth; }\n`,
  );
  assert.ok(rulesFired(domAccess).includes("no-restricted-globals"));
});

test("the removed normalized annotation space cannot come back by name", async () => {
  for (const name of ["DEFAULT_ANNOTATION_SPACE", "screenToAnnotation", "annotationToScreen", "imageToAnnotation", "nearestTouchVertex"]) {
    const messages = await lint(
      "app/editor/viewport/offender.ts",
      `export function ${name}() { return 1; }\n`,
    );
    assert.ok(
      rulesFired(messages).includes("no-restricted-syntax"),
      `${name} should be rejected in the viewport stack`,
    );
  }
});

test("the annotate route cannot grow editor state back", async () => {
  const hookCall = await lint(
    "app/annotate/page.tsx",
    `import { useState } from "react";\nexport default function Page() { const [a] = useState(0); return a; }\n`,
  );
  assert.ok(rulesFired(hookCall).includes("no-restricted-syntax"));

  const stateImport = await lint(
    "app/annotate/page.tsx",
    `import { useEditorState } from "../editor/state/use-editor-state";\nexport default function Page() { return useEditorState; }\n`,
  );
  assert.ok(rulesFired(stateImport).includes("no-restricted-imports"));
});

test("the real source tree passes every architecture rule", async () => {
  const results = await eslint.lintFiles(["app"]);
  const boundaryViolations = results.flatMap((result) =>
    result.messages
      .filter((message) => /no-restricted-(imports|globals|syntax)/.test(message.ruleId ?? ""))
      .map((message) => `${result.filePath}:${message.line} ${message.ruleId}`));
  assert.deepEqual(boundaryViolations, []);
});
