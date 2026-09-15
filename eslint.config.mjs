import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Architecture boundaries live here rather than in the test suite.
 *
 * They used to be `assert.ok(!source.includes(token))` over a file read in
 * tests/editor-architecture-boundaries.test.mjs and
 * tests/no-normalized-editor-space.test.mjs. A lint rule is the right home: it
 * runs in the editor while the import is being typed instead of failing later
 * in CI, it reports the offending line, and it cannot drift out of sync with a
 * file that was moved or renamed.
 */

/** Presentation renders; it never reaches into editor state or geometry. */
const presentationMustNotOwnState = {
  files: [
    "app/editor/presentation/**",
    "app/editor/panels/**",
    "app/editor/demo/**",
  ],
  rules: {
    // The TypeScript-aware variant, so that importing a shared *type* from a hook
    // module stays allowed: a type import leaves no runtime dependency behind.
    "no-restricted-imports": "off",
    "@typescript-eslint/no-restricted-imports": ["error", {
      patterns: [
        {
          group: [
            "**/state/use-editor-state",
            "**/interactions/use-canvas-interactions",
            "**/drawing/use-drawing-interactions",
            "**/interactions/use-advanced-vector-interactions",
            "**/session/editor-session-io",
            "**/geometry/vector-operations",
          ],
          allowTypeImports: true,
          message:
            "Presentation components take props and emit callbacks. Editor state, interaction hooks, session IO and vector geometry belong to the workbench.",
        },
      ],
    }],
  },
};

/** Pure models stay framework-independent so they can be reasoned about and tested directly. */
const modelsStayPure = {
  files: [
    "app/editor/state/editor-state.ts",
    "app/editor/panels/panel-model.ts",
    "app/editor/selection/selection-model.ts",
    "app/editor/models/**",
    "app/editor/geometry/**",
  ],
  rules: {
    "no-restricted-imports": ["error", {
      paths: [
        { name: "react", message: "Models are framework-independent; keep hooks in the hook layer." },
        { name: "react-dom", message: "Models are framework-independent." },
      ],
    }],
    "no-restricted-globals": ["error",
      { name: "window", message: "Models must not touch the DOM; pass what they need as arguments." },
      { name: "document", message: "Models must not touch the DOM; pass what they need as arguments." },
    ],
  },
};

/**
 * The editor has exactly two coordinate spaces: browser screen pixels and
 * source-image pixels. The removed normalized annotation space kept creeping
 * back in through helpers named after it.
 */
const noNormalisedAnnotationSpace = {
  files: [
    "app/lib/editor-viewport.ts",
    "app/lib/touch-gestures.ts",
    "app/editor/viewport/**",
    "app/editor/geometry/**",
    "app/editor/selection/**",
  ],
  rules: {
    "no-restricted-syntax": ["error",
      {
        selector: "Identifier[name=/^(DEFAULT_ANNOTATION_SPACE|screenToAnnotation|annotationToScreen|annotationToImage|imageToAnnotation|nearestTouchVertex)$/]",
        message:
          "The normalized annotation space was removed. Convert between screen pixels and source-image pixels only.",
      },
    ],
  },
};

/** The route composes; it never owns editor logic. */
const routeStaysThin = {
  files: ["app/annotate/page.tsx"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["**/state/**", "**/interactions/**", "**/canvas/**", "**/session/**"],
          message: "/annotate composes the workbench and nothing else.",
        },
      ],
    }],
    "no-restricted-syntax": ["error",
      {
        selector: "CallExpression[callee.name=/^use[A-Z]/]",
        message: "/annotate must not own editor state; the workbench does.",
      },
    ],
  },
};

/**
 * The codebase already marks intentionally unused callback parameters with a
 * leading underscore. Teaching the rule that convention turns fourteen false
 * positives into silence and keeps a real unused variable visible.
 */
const underscoreMeansIntentionallyUnused = {
  files: ["**/*.{ts,tsx,mts,js,mjs,jsx}"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
    }],
  },
};

/**
 * Pre-existing findings, capped rather than ignored.
 *
 * These 50-odd react-hooks reports predate lint running in CI at all, and each
 * needs a real look — several are the ref-during-render pattern the workbench
 * uses deliberately. Downgrading them to warnings lets the rules above fail the
 * build for a genuine architecture violation, while `--max-warnings` keeps this
 * count from growing. Lower the ceiling as they are fixed; never raise it.
 */
const cappedLegacyFindings = {
  files: ["app/**/*.{ts,tsx}"],
  rules: {
    "react-hooks/refs": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/exhaustive-deps": "warn",
    "@next/next/no-img-element": "warn",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  underscoreMeansIntentionallyUnused,
  cappedLegacyFindings,
  presentationMustNotOwnState,
  modelsStayPure,
  noNormalisedAnnotationSpace,
  routeStaysThin,
  {
    files: ["tests/**", "scripts/**"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": "off",
      "no-restricted-syntax": "off",
      "no-restricted-globals": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "dist/**",
  ]),
]);

export default eslintConfig;
