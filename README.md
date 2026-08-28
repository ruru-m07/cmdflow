# Cmdflow

Cmdflow is a headless React framework for building product-grade action panels. It aims to
provide the registration, state, ranking, recency, and interaction primitives that sit behind
command interfaces in products such as Raycast, GitHub, and Linear, while leaving rendering and
styling entirely to the product.

## Workspace

- `apps/web` — the Cmdflow website and development surface
- `packages/core` — framework-agnostic action-panel state and behavior
- `packages/react` — headless React bindings published as `@cmdflow/react`

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
bun run build
```

[Biome](https://biomejs.dev/) handles formatting, linting, and import organization from the
workspace root.

## Changelogs and releases

[Tegami](https://tegami.fuma-nama.dev/) manages changelogs, coordinated package versions, npm
publishing, git tags, and GitHub releases. `@cmdflow/core` and `@cmdflow/react` belong to one
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
