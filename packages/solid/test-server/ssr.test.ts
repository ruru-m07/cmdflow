import { expect, test } from "bun:test";
import { createCmdFlow } from "@cmdflow/core";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import { Command } from "../src/index.js";

test("Solid SSR uses the same cached core snapshot without DOM access", () => {
  const flow = createCmdFlow({
    commands: [
      { id: "github", title: "GitHub" },
      { id: "linear", title: "Linear" },
    ],
  });
  flow.setQuery("Linear");
  const html = renderToString(() =>
    createComponent(Command.Root, {
      store: flow,
      get children() {
        return createComponent(Command.Dialog, {
          "aria-label": "Server commands",
          get children() {
            return [
              createComponent(Command.Input, { "aria-label": "Search" }),
              createComponent(Command.List, {
                children: (item) => createComponent(Command.Item, { item }),
              }),
            ];
          },
        });
      },
    }),
  );
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-label="Server commands"');
  expect(html).toContain("GitHub");
  expect(html).not.toContain('value="Linear"');
  flow.destroy();
});
