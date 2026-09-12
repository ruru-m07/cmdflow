# Implementation status and contributor guide

Last updated: 2026-09-12. Status: initial pre-release implementation, not a production-readiness claim.

Start with [architecture](architecture.md) for product intent. Start with package README files and
exported TypeScript types for the current API. Do not invent a second engine in a framework adapter.

## Dependency and ownership map

```text
@cmdflow/core          registry, immutable snapshots, sources, ranking, forms, execution
    ↑
@cmdflow/dom           native events, ARIA/focus, commit effects, virtual window, CSS
    ↑           ↑
@cmdflow/react  @cmdflow/solid   framework subscriptions, refs, rendering, lifecycle
```

`@cmdflow/dom/persistence` is opt-in and not imported by the default DOM entrypoint. It implements
the core `RankingStore` contract with IndexedDB and fingerprinted query keys. All four packages
share one Tegami release group. The website is a consumer, never an implementation dependency.

## Implemented behavior and evidence

| Area | Current implementation | Executable evidence |
| --- | --- | --- |
| Registry/context | Atomic registration/disposal, namespaced candidates, reactive predicates | `packages/core/tests/store.test.ts` |
| Snapshots/navigation | Cached immutable snapshots, separate main/actions stacks, nested views | Core store and lifecycle tests |
| Execution | Captured origin, abortable work, disabled/destructive guards, structured outcomes | `packages/core/tests/lifecycle.test.ts` |
| Async sources | Debounce, generations, abort, streamed batches, pagination and isolated errors | Core store tests + `packages/core/tests/sources.test.ts` |
| Ranking | Versioned Unicode normalization, relevance bands, fixed-point decay, scoped feedback | `packages/core/tests/ranking.test.ts` |
| Persistence | HMAC fingerprints, atomic IDB updates, idempotency, reset/TTL/quota/fallback | `packages/dom/tests/persistence.test.ts` |
| Forms | Field state, async validation, safe drafts, nested preservation, dirty confirmation | Core + adapter form fixtures |
| DOM | Prop/delegated modes, native dialog integration, IME, ARIA reference validation, focus | `packages/dom/tests/controller.test.ts` + `e2e/dom.spec.ts` |
| React | External-store subscriptions, SSR/hydration, ref cleanup, headless primitives | `packages/react/test` + `e2e/react.spec.ts` + `e2e/accessibility.spec.ts` |
| Solid | Same controller, reactive props/keyed rows, SSR/client ownership | `packages/solid/test`, `packages/solid/test-server`, and `e2e/solid.spec.ts` |
| Styling/virtualization | Optional scoped reset/preset; fixed-height logical window with active pinning | DOM utility fixtures |

Tests are evidence for their named cases, not proof of universal accessibility or race freedom.
Happy DOM and fake-indexeddb are useful simulations; native browser/assistive-technology behavior
requires separate verification. Keep the release gate below honest as work progresses.

## Important API decisions from the first implementation

1. `CmdFlowOptions.context` accepts either plain application context or a subscribed context store.
   `setContext` is the explicit invalidation boundary. Predicates must be pure and cheap.
2. `ViewDefinition` is plain data plus command/validator callbacks; renderer/payload keys are opaque.
   Framework components and DOM nodes stay in application-side render registries.
3. `getServerSnapshot()` caches the initial snapshot. The host owns the engine lifetime; renderer
   unmount only removes that renderer's bindings. Do not destroy a reused store during StrictMode
   effect replay. Do not allocate a globally shared user-specific store during server rendering.
4. Programmatic invocation may omit an address for application work only. UI outcomes require an
   explicit live address. Browser bindings always capture and pass that address.
5. Duplicate registration currently throws consistently in all builds, preserving the first owner.
   There is no environment-dependent silent rejection path yet.
6. Provider ranks have a presence tier before numerical comparison. Pairwise skipping when one
   rank is absent breaks transitivity. Canonical composite IDs break remaining ties.
7. Successful invocation records the origin query/scope, including invocations from contextual
   actions. Durable storage is background work and cannot delay navigation. In-flight learning is
   invalidated by an explicit local history reset.
8. Keyboard navigation freezes incoming history reranking until another query/open cycle; active
   identity is distinct from selection. New source results can still appear without stale IDs.
9. `setOpen()` is host authority; `close()` is a request and applies dirty-discard policy. Safe draft
   persistence is explicit. Password/sensitive values stay out of draft exports and ranking keys.
10. Source namespaces `registry` and `view:*` are reserved. Execution IDs contain instance entropy
    because persistence operation receipts survive reload; this is not a security-token API.
11. Narrow navigation/selection/scroll commits preserve unchanged result and payload references.
    Query changes reuse static result metadata; definitions with dynamic predicates are reevaluated.
    Do not replace this with a mutable snapshot or use host-provided shallow freezing as proof that
    nested data is immutable.

## Contributor workflow

```sh
bun install --frozen-lockfile
bun run check
bun run check-types
bun run test
bun run build
bun run test:packages
bunx playwright install chromium firefox webkit
bun run test:e2e
bun run bench
```

Use root tasks so dependency packages build before consumers. Package tests are intentionally
isolated; Solid client fixtures require `--conditions=browser`, unlike Solid SSR fixtures. Do not
run a single unconfigured `bun test` over the whole repository and confuse framework resolution.

Add a failing invariant-level test before changing lifecycle policy. Test frame/session disposal
and late resolution, not just successful arrival. Keep ranking features finite and comparators
transitive; never add arrival-order or ambient-locale tie breakers. Keep DOM effects behind a
renderer commit (`controller.sync(snapshot)`), never an assumed microtask.

The browser suite starts the built Next.js app on port 4321 and an in-memory-bundled vanilla/Solid
fixture on port 4322. Build first. Stop or restart any existing fixtures after changing package
output; local Playwright runs reuse already-running servers. CI starts fresh servers. Browser
traces and axe reports belong in ignored `test-results`, not committed source.

## Verification recorded on 2026-09-12

- Frozen Bun install, Biome, all package/app type checks, and strict test/fixture type checks passed.
- **147 package tests passed:** 90 core, 40 DOM/persistence, 10 React, 6 Solid client, and 1 Solid SSR.
  Provider tests cover stale pages, context replacement, retries, atomic batch application,
  observer reentrancy, and throwing iterator cleanup, not only the happy path.
- All four library declaration builds and the Next.js production build passed.
- `bun run test:packages` packed real archives and installed an isolated consumer. It verified
  Node SSR-safe imports, React/Solid server rendering, CSS export paths, public manifests, rewritten
  workspace versions, and strict NodeNext declarations with `skipLibCheck: false`. Local tarball
  overrides substitute the not-yet-published transitive packages; this does not prove npm registry
  permissions or trusted-publishing setup.
- **66 Playwright cases passed** in the final combined run across Chromium, Firefox, and WebKit:
  9 vanilla DOM workflows, 5 React workflows, 4 Solid workflows, and 4 axe scenarios per browser.
  These exercise the sixth-result learning/reload path, nested actions, destructive confirmation,
  forms/drafts, async pagination/retry, focus restoration, controlled cancellation, synthetic IME,
  ShadowRoot/iframe ownership, narrow layouts, and disposal.
- The 12 axe cases found no violations of the selected WCAG 2/2.1 A/AA rules in the tested React
  panel states. They scanned the whole page without exclusions or disabled rules; form checks ran
  before and after a validation error. Reports retain `incomplete` findings for manual review.
  This is not a WCAG conformance certification or a screen-reader pass.
- The Next.js demo was also inspected visually at desktop and narrow widths. Its GitHub data,
  delayed source pages, execution, forms, and destructive preview are local demonstrations, not
  real GitHub mutations.

### Engine benchmark baseline

One local Bun 1.3.0 run of `bun run bench` measured the following. Each size uses 200 active moves,
200 scroll-anchor updates, and 12 query changes over static commands; startup is a single sample.
The benchmark includes no DOM rendering, source transport, IndexedDB, or framework subscriptions.

| Commands | Startup | Mean active move | Mean scroll commit | Mean query |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 12.26 ms | 0.123 ms | 0.008 ms | 2.103 ms |
| 10,000 | 61.60 ms | 0.890 ms | 0.004 ms | 16.728 ms |

These are diagnostic samples, not hardware-independent budgets or p95 keypress-to-paint claims.
The first 10k query run exposed repeated linear item lookups inside an item loop. Removing that
quadratic work and caching eligible static metadata reduced the observed mean from roughly 459 ms
to 17 ms. Rerun the benchmark after changing snapshot construction or ranking; also profile a real
consumer before making performance promises.

## Remaining production-readiness gates

- Assistive-technology walkthroughs: VoiceOver/Safari, NVDA/Firefox or Chrome, and relevant enterprise
  combinations, plus real Japanese/Chinese/Korean IME input. Synthetic events and zero axe violations
  do not establish speech behavior or platform IME correctness.
- Browser keypress-to-paint distributions at 1k/10k candidates, large provider batches, virtual
  scrolling, and repeated mount/unmount memory profiling. The engine-only means above are not a
  substitute for slow-device or long-running consumer measurements.
- Randomized long-running provider/execution sequences and browser-specific storage denial, quota,
  eviction, and cross-tab behavior. Deterministic conformance tests do not prove every interleaving.
- Broader adapter/version and hydration matrices, production virtualizers, and host portal layouts.
  Existing ShadowRoot/iframe/native-dialog fixtures establish their named cases only. Fixed-height
  helpers do not imply arbitrary measured-row support, and cross-root ARIA remains intentionally
  unsupported. React's declared peer range still needs a release-level supported-version matrix.
- npm organization/bootstrap configuration and an explicitly authorized release. No npm publish,
  external GitHub release, or CI run has been performed for this implementation.
- Adopter feedback on registration/extension ergonomics, renderer payload ownership, optional
  diagnostics tooling, and form integration before freezing a 1.0 API.

Update this section with commands and observed results, not inferred passes. Preserve the broader
roadmap in the architecture document; this implementation status must not silently reduce scope.
