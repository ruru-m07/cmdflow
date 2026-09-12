import { createCmdFlow } from "../src/index.js";

const iterations = 200;
const results = [];
for (const count of [1_000, 10_000]) {
  const created = performance.now();
  const store = createCmdFlow({
    commands: Array.from({ length: count }, (_, index) => ({
      id: String(index).padStart(5, "0"),
      title: `Command ${index}`,
      run: () => {},
    })),
  });
  const startupMs = performance.now() - created;
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) store.moveActive("next");
  const navigationMs = performance.now() - started;
  const active = store.getSnapshot().current.activeId;
  if (!active) throw new Error("Benchmark fixture has no active command");
  const scrollStarted = performance.now();
  for (let index = 0; index < iterations; index += 1)
    store.setScrollAnchor({ candidateId: active, offset: -index });
  const scrollMs = performance.now() - scrollStarted;
  const queries = 12;
  const queryStarted = performance.now();
  for (let index = 0; index < queries; index += 1) store.setQuery(`command ${index}`);
  const queryMs = performance.now() - queryStarted;
  results.push({
    count,
    iterations,
    startupMs: +startupMs.toFixed(2),
    navigationMeanMs: +(navigationMs / iterations).toFixed(3),
    scrollMeanMs: +(scrollMs / iterations).toFixed(3),
    queryMeanMs: +(queryMs / queries).toFixed(3),
  });
  store.destroy();
}
console.table(results);
