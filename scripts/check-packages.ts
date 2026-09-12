import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(join(tmpdir(), "cmdflow-packages-"));
const archives = join(workspace, "archives");
const consumer = join(workspace, "consumer");
const packages = ["core", "dom", "react", "solid"] as const;

async function run(command: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return stdout.trim();
}

try {
  await Promise.all([mkdir(archives), mkdir(consumer)]);
  const dependencies: Record<string, string> = {
    react: "19.2.8",
    "react-dom": "19.2.8",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "solid-js": "1.9.15",
  };
  const expectedVersions: Record<string, string> = {};
  for (const name of packages) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const archiveName = `${name}.tgz`;
    await run(
      [
        "bun",
        "pm",
        "pack",
        "--filename",
        join(archives, archiveName),
        "--ignore-scripts",
        "--quiet",
      ],
      directory,
    );
    const listing = await run(["tar", "-tzf", join(archives, archiveName)], workspace);
    for (const required of [
      "package/package.json",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/README.md",
    ]) {
      if (!listing.split("\n").includes(required))
        throw new Error(`${manifest.name} archive is missing ${required}`);
    }
    dependencies[manifest.name] = `file:../archives/${archiveName}`;
    expectedVersions[manifest.name] = manifest.version;
  }
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "cmdflow-package-smoke",
        private: true,
        type: "module",
        dependencies,
        overrides: Object.fromEntries(
          Object.keys(expectedVersions).map((name) => [name, dependencies[name]]),
        ),
      },
      null,
      2,
    ),
  );
  await run(["bun", "install", "--ignore-scripts"], consumer);

  await writeFile(
    join(consumer, "ssr.mjs"),
    `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCmdFlow } from "@cmdflow/core";
import { createDomController } from "@cmdflow/dom";
import { createIndexedDBRankingStore } from "@cmdflow/dom/persistence";
import { Command as ReactCommand } from "@cmdflow/react";
import { Command as SolidCommand } from "@cmdflow/solid";
import { createElement } from "react";
import { renderToString as renderReact } from "react-dom/server";
import { createComponent } from "solid-js";
import { renderToString as renderSolid } from "solid-js/web";

assert.equal(typeof document, "undefined", "this smoke must execute without DOM globals");
const flow = createCmdFlow({ commands: [{ id: "smoke", title: "Packed command", run() {} }] });
const dom = createDomController(flow);
assert.equal(dom.getInputProps().role, "combobox");
const reactHTML = renderReact(createElement(ReactCommand.Root, { store: flow },
  createElement(ReactCommand.Dialog, { "aria-label": "Packed React palette" },
    createElement(ReactCommand.Input),
    createElement(ReactCommand.List, { children: (item) => createElement(ReactCommand.Item, { key: item.candidateId, item }) }))));
assert.match(reactHTML, /Packed command/);
assert.match(reactHTML, /role="combobox"/);
const solidHTML = renderSolid(() => createComponent(SolidCommand.Root, {
  store: flow,
  get children() { return createComponent(SolidCommand.Dialog, {
    "aria-label": "Packed Solid palette",
    get children() { return [createComponent(SolidCommand.Input, {}),
      createComponent(SolidCommand.List, { children: (item) => createComponent(SolidCommand.Item, { item }) })]; }
  }); }
}));
assert.match(solidHTML, /Packed command/);
assert.match(solidHTML, /role="combobox"/);

const versions = ${JSON.stringify(expectedVersions)};
for (const name of Object.keys(versions)) {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve(name))));
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  assert.equal(manifest.version, versions[name]);
  for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
    assert.ok(!String(version).startsWith("workspace:"), name + " contains an unpublished workspace reference");
    if (dependency in versions) assert.equal(version, versions[dependency]);
  }
  for (const entry of Object.values(manifest.exports)) {
    if (typeof entry === "object" && entry.types) {
      assert.ok((await readFile(join(directory, entry.types), "utf8")).length > 0, name + " has empty declarations");
    }
  }
}
for (const name of ["reset.css", "preset.css"]) {
  const css = await readFile(fileURLToPath(import.meta.resolve("@cmdflow/dom/" + name)), "utf8");
  assert.match(css, /@layer/);
}
const persistence = createIndexedDBRankingStore({ indexedDB: null, queryRetention: "none" });
await persistence.ready;
persistence.destroy();
dom.destroy();
flow.destroy();
console.log("Packed packages: Node SSR, React/Solid rendering, exports, CSS, and workspace version rewriting passed.");
`,
  );

  await writeFile(
    join(consumer, "consumer.ts"),
    `
import { createCmdFlow, type CmdFlowSnapshot } from "@cmdflow/core";
import { createDomController } from "@cmdflow/dom";
import { createIndexedDBRankingStore } from "@cmdflow/dom/persistence";
import { Command as ReactCommand, useCmdflowSelector } from "@cmdflow/react";
import { Command as SolidCommand, createCmdflow } from "@cmdflow/solid";
const flow = createCmdFlow({ context: { workspace: "smoke" }, commands: [{ id: "typed", title: "Typed command", run: ({ appContext }) => { appContext.workspace.toUpperCase(); } }] });
const snapshot: CmdFlowSnapshot = flow.getSnapshot();
const dom = createDomController(flow);
dom.getInputProps("main", snapshot);
const persistence = createIndexedDBRankingStore({ indexedDB: null });
void [ReactCommand, SolidCommand, useCmdflowSelector, createCmdflow, persistence];
`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ["ES2022", "DOM", "DOM.Iterable"],
        },
        files: ["consumer.ts"],
      },
      null,
      2,
    ),
  );
  console.log(await run(["node", "ssr.mjs"], consumer));
  await run(
    [join(root, "node_modules", ".bin", "tsc"), "--project", join(consumer, "tsconfig.json")],
    consumer,
  );
  console.log("Packed package declaration consumer passed with strict NodeNext resolution.");
  await rm(workspace, { recursive: true });
} catch (error) {
  console.error(`Package smoke failed. Generated artifacts retained at ${workspace}`);
  throw error;
}
