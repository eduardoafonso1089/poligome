# Test layers

Four tiers, cheapest first. A change should be caught by the cheapest tier that
can see it, so that a failure names the cause instead of pointing at a browser
screenshot.

| Tier | Command | What it covers | Cost |
|---|---|---|---|
| **Unit** | `npm run test:unit` | Pure functions: geometry, reducers, selection, import/export, project format | seconds, no build |
| **Component** | `npm run test:unit` | What a component renders, via `react-dom/server` | seconds, no build |
| **Build** | `npm run test:build` | The artifact `vinext build` produces, export goldens, i18n parity | ~1 min |
| **Functional** | `npm run test:audit` | The editor driven in Chromium: draw, drag, undo, mobile gestures | ~3 min |

`npm test` runs typecheck plus the first two tiers — that is the loop to keep
open while working. CI runs all four.

## Writing a component test

Assert on what the component renders, never on the text of its source file.

```js
import { render, attributeValues } from "./helpers/render.mjs";
import { PolygonLayer } from "../app/editor/layers/polygon-layer.tsx";

const markup = render(PolygonLayer, { annotation, ...props });
assert.equal(attributeValues(markup, "d")[0], "M 10 10 L 200 10 Z");
```

`helpers/render.mjs` carries the query helpers — `attributeValues`,
`countClass`, `buttons`, `attribute`, `text`. `helpers/editor-fixtures.mjs`
carries the shared props and annotations, so a test states only what it varies.

`react-dom/server` runs hooks once and returns markup. That is enough for
structure, wiring, copy and disabled state. Anything needing a real pointer or a
second render belongs in the functional tier.

## Why not assert on source text

Twenty-six suites used to read a source file and run a regex over it. Two
failure modes, both of which happened:

- **False alarm.** One required an entire arrow function to sit on a single
  line, so running a formatter failed CI. Two others guarded `VectorToolbar`,
  a component nothing renders — they were green for a year while the feature
  behind them was unreachable.
- **False confidence.** `assert.match(chrome, /className="topbar"/)` passes
  whether or not the topbar works, and fails if it moves to a CSS module.

Architecture boundaries are the exception that proved to be a lint problem, not
a test problem — they live in `eslint.config.mjs` now, and
`architecture-guards.test.mjs` feeds ESLint deliberately broken code to prove
the rules still fire.

### When the source really is the only witness

A few contracts leave no trace in markup: an effect that only runs in a browser,
a listener registered with `{ passive: false }`, the order of two statements
inside a closure, an import that must *not* exist. Those stay source
assertions — but they go through `helpers/source.mjs`:

```js
import { region, sourceOf } from "./helpers/source.mjs";

assert.match(sourceOf("app/editor/viewport/use-editor-viewport.ts"), /passive: false/);
assert.match(region(WORKBENCH, "function duplicatePolygon", "function "), /makeId\("copy"\)/);
```

`sourceOf` collapses every run of whitespace to a single space, so a regex
written on one line still matches after the file is wrapped or reformatted.
`region` scopes an assertion to one function, `cssRule` to one CSS rule, and
`lineCount` answers the rare question about a file's size.
`architecture-guards.test.mjs` fails the build if a test reads `app/` or `docs/`
without the helper.

## Running the functional tier locally

```bash
npm ci
npx playwright install chromium   # once
npm run test:audit
```

The script builds the static export, serves it, and runs all eight audits. If
the machine already carries a Chromium from a different Playwright release,
point at it instead of downloading another:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm run test:audit
```

`npm start` is not a substitute for the static export here: with
`trailingSlash: true` it answers 308 for `/demo/*.jpg` and the demo never loads.

## Coverage

```bash
npm run test:coverage
```

Read it per file, not as one number. The aggregate is currently ~41% of lines,
and it *fell* from 94% while the suite grew from 222 to 318 tests — because
rendering the whole workbench finally loads the modules that unit tests never
imported. A file nobody measured was never 94% covered; it was absent from the
denominator.

What the aggregate hides:

| Kind of module | Lines | Covered by |
|---|---|---|
| Models, geometry, import/export, project format | 90–100% | unit tier |
| Layers, chrome, panels, drafts, export menu | 95–100% | component tier |
| Pointer and gesture hooks, import dialogs, COG layer | 25–60% | functional tier, which coverage does not measure |
| `app/lib/sam.ts` | 35% | dormant until the SAM branch lands |

So the number to watch is a file dropping out of the first two rows, not the
total. CSS modules and the tests themselves are excluded from the report.
