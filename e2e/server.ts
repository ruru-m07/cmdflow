const build = await Bun.build({
  entrypoints: [new URL("./fixtures/dom.ts", import.meta.url).pathname],
  target: "browser",
  format: "esm",
  sourcemap: "inline",
});
if (!build.success || !build.outputs[0]) {
  throw new AggregateError(build.logs, "Could not build the CmdFlow browser fixture");
}
const script = await build.outputs[0].text();
const solidBuild = await Bun.build({
  entrypoints: [new URL("./fixtures/solid.ts", import.meta.url).pathname],
  target: "browser",
  conditions: ["browser"],
  format: "esm",
  sourcemap: "inline",
});
if (!solidBuild.success || !solidBuild.outputs[0]) {
  throw new AggregateError(solidBuild.logs, "Could not build the Solid browser fixture");
}
const solidScript = await solidBuild.outputs[0].text();
const markup = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CmdFlow DOM conformance</title>
<style>
body { font: 16px system-ui; padding: 2rem; }
dialog { width: min(34rem, 80vw); padding: 1rem; }
[data-cmdflow-part="list"] { height: 13rem; overflow: auto; }
[data-cmdflow-part="item"] { padding: .5rem; }
[data-state="active"] { outline: 2px solid Highlight; }
[data-disabled="true"] { opacity: .6; }
input { display: block; width: 90%; margin: .5rem; }
button { margin: .25rem; }
iframe { width: 90vw; height: 40rem; }
</style></head><body><h1>CmdFlow DOM conformance</h1>
<script type="module" src="/fixture.js"></script></body></html>`;
const solidMarkup = markup
  .replaceAll("CmdFlow DOM conformance", "CmdFlow Solid conformance")
  .replace("/fixture.js", "/solid.js");

Bun.serve({
  hostname: "127.0.0.1",
  port: 4322,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/solid.js")
      return new Response(solidScript, {
        headers: { "content-type": "text/javascript", "cache-control": "no-store" },
      });
    if (url.pathname === "/solid")
      return new Response(solidMarkup, {
        headers: { "content-type": "text/html", "cache-control": "no-store" },
      });
    if (url.pathname === "/fixture.js")
      return new Response(script, {
        headers: { "content-type": "text/javascript", "cache-control": "no-store" },
      });
    if (url.pathname === "/health") return new Response("ready");
    if (url.pathname === "/")
      return new Response(markup, {
        headers: { "content-type": "text/html", "cache-control": "no-store" },
      });
    return new Response("Not found", { status: 404 });
  },
});
