# CmdFlow

CmdFlow is a framework-agnostic engine with headless adapters for building product-grade action
panels. It aims to provide the registration, state, search, learned ranking, navigation, and
interaction primitives that sit behind command interfaces in products such as Raycast, GitHub,
and Linear. Products keep control of their markup and styling through CmdFlow's behavioral
bindings, accessible defaults, and optional styles.

The proposed product model, package boundaries, accessibility contract, ranking design, and
delivery roadmap live in [the architecture document](docs/architecture.md).
See [implementation status](docs/implementation.md) for the current API, test evidence, and
remaining release gates. The library is pre-release; the architecture examples are not API guarantees.

## Workspace

- `apps/web` — the CmdFlow website and development surface
- `packages/core` — framework-agnostic action-panel state and behavior
- `packages/dom` — browser bindings, optional reset/preset CSS, and opt-in IndexedDB persistence
- `packages/react` — headless React bindings published as `@cmdflow/react`
- `packages/solid` — headless Solid bindings over the same engine and browser controller

The repository uses Bun workspaces and Turborepo. Shared TypeScript defaults live in the root
`tsconfig.json`; there is no configuration package.

## Development

```sh
bun install
bun run dev
```

Useful checks:

```sh
bun run check
bun run check:fix
bun run check-types
bun run test
bun run build
bun run test:packages
bunx playwright install chromium firefox webkit
bun run test:e2e
bun run bench
```

Build before running browser or packed-package checks. Playwright starts the production demo and
vanilla/Solid fixtures on ports 4321/4322; restart existing fixtures after package changes. `bench`
measures engine-only work, not browser latency. See [verification and release gates](docs/implementation.md).

[Biome](https://biomejs.dev/) handles formatting, linting, and import organization from the
workspace root.

## Changelogs and releases

[Tegami](https://tegami.fuma-nama.dev/) manages changelogs, coordinated package versions, npm
publishing, git tags, and GitHub releases. All four `@cmdflow/*` packages belong to one
release group and always receive the same version bump.

Create a changelog before merging a user-facing package change:

```sh
bun run tegami
```

Commit the generated `.tegami/*.md` file with the change. Pushes to `main` run the publish
workflow: Tegami first opens or updates its Version Packages pull request, then publishes after
that pull request is merged.

The npm packages are configured for public access and trusted publishing. Before the first real
release, an npm organization owner must run the one-time Tegami bootstrap described in the
[trusted-publishing guide](https://tegami.fuma-nama.dev/plugins/npm#trusted-publishing).
