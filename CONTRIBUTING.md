# Contributing to CmdFlow

CmdFlow is a Bun workspace with four publishable packages and one Next.js development surface.

```text
@cmdflow/core  <-  @cmdflow/dom  <-  @cmdflow/react
                              \-  @cmdflow/solid
```

Keep that dependency direction strict:

- core owns definitions, state, navigation, sources, execution, forms, and ranking;
- DOM owns browser events, focus, modal behavior, ARIA, and optional CSS;
- framework adapters own lifecycle, subscriptions, idiomatic composition, and rendering helpers;
- the web app demonstrates the public adapter API rather than reaching into internals.

## Local development

Install dependencies from the repository root:

```sh
bun install
```

Start the website from the repository root. Turborepo builds its package dependencies first, so a
fresh clone does not require a separate bootstrap command:

```sh
bun run dev
```

[Biome](https://biomejs.dev/) owns formatting, linting, and import organization from the root
configuration. Shared TypeScript defaults live in the root `tsconfig.json`; do not create a
configuration package.

## Source rules

- Public entrypoints export deliberate consumer contracts, not implementation barrels.
- Internal modules import their concrete dependencies rather than package entrypoints.
- Definitions are normalized and validated where they enter the runtime.
- Runtime modules own one lifecycle each; orchestration modules coordinate rather than reimplement.
- DOM prop bindings and delegated native listeners stay separate.
- Framework primitives present engine state but do not duplicate engine policy.
- Keep command-palette keyboard interactions immediate. Do not animate opening or navigation.

The current public direction is documented in [docs/api-v0.2.md](docs/api-v0.2.md). Update that
contract before introducing a competing public concept or naming scheme.

## Changelogs and releases

[Tegami](https://tegami.fuma-nama.dev/) coordinates package versions, changelogs, tags, and npm
publishing. All `@cmdflow/*` packages are released as one versioned group. User-facing package
changes should include the appropriate Tegami changelog entry; run `bun run tegami` to open the
changelog workflow.
