import { readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const packageDirectory = resolve(process.cwd());
const manifestPath = join(packageDirectory, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: unknown };

if (typeof manifest.name !== "string" || !manifest.name.startsWith("@cmdflow/")) {
  throw new Error(`Refusing to clean dist for non-CmdFlow package: ${String(manifest.name)}`);
}

const distDirectory = resolve(packageDirectory, "dist");
if (dirname(distDirectory) !== packageDirectory || basename(distDirectory) !== "dist") {
  throw new Error(`Refusing to clean unexpected path: ${distDirectory}`);
}

await rm(distDirectory, { recursive: true, force: true });
