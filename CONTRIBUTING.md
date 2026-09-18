# Contributing to Poligome

Thank you for helping build free, local-first data tooling for AI.

## Before opening a change

- Search existing issues and discussions first.
- For a substantial feature or a new dependency, open an issue before implementing it.
- Keep data processing local by default. A feature that uploads user data needs explicit prior discussion and clear consent in the interface.
- Keep the interface and user-facing errors available in Portuguese, English, French, and Spanish.

## Branch names

Name a branch after the problem it solves, so the branch list reads as a list of
work in progress.

- Prefix by intent: `fix/` for a defect, `feature/` for new behavior, `refactor/`
  for structure with no behavior change, `docs/` for documentation, `audit/` for
  an investigation that produces findings.
- After the prefix, lowercase kebab-case, two to six words:
  `fix/mobile-touch-navigation`, `feature/coco-yolo-export-options`.
- The name says what is being solved, never who or what produced it. A name a
  tool generated, such as `claude/adoring-bardeen-coi4l0`, is renamed before the
  pull request is opened.
- Delete the branch once its pull request is merged or closed. A branch whose
  content already lives in `main` only adds noise to the list.

## Development

Poligome requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Before submitting a pull request, run:

```bash
npm run lint
npm test          # typecheck + unit and component tests, no build
```

For a change that touches the build, the export formats or the editor's
interactions, also run the slower tiers:

```bash
npm run test:build   # the built artifact, export goldens, i18n parity
npm run test:audit   # the editor driven in Chromium
```

`tests/README.md` describes the four tiers and how to write a test in each.
Assert on what a component renders, never on the text of its source file;
architecture boundaries are lint rules in `eslint.config.mjs`, not tests.

Describe the user problem, the behavior before and after the change, and how you verified it. Include screenshots or a short recording for interface changes. Do not include private datasets, credentials, model checkpoints, or generated build artifacts.

## Scope and design principles

- The official application remains free and usable without an account.
- Datasets and annotations stay on the user's machine unless the user deliberately exports them.
- Portable project formats should remain backward compatible. A format change needs a version migration.
- Exported datasets should be valid, documented, and usable by common downstream tools.
- Accessibility and keyboard workflows are product requirements, not optional polish.

## License

By contributing, you agree that your contribution is licensed under `AGPL-3.0-only`. Add your name to the contributors section of `NOTICE` when submitting a material contribution.

