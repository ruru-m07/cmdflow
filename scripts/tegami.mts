import { tegami } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const paper = tegami({
  ignore: ["cmdflow", "web"],
  groups: {
    cmdflow: {
      syncBump: true,
      syncGitTag: true,
    },
  },
  npm: {
    client: "bun",
    trustedPublish: {
      provider: "github",
      workflow: "publish.yml",
    },
  },
  packages: {
    "@cmdflow/core": { group: "cmdflow" },
    "@cmdflow/dom": { group: "cmdflow" },
    "@cmdflow/react": { group: "cmdflow" },
    "@cmdflow/solid": { group: "cmdflow" },
  },
  plugins: [
    github({
      repo: "ruru-m07/cmdflow",
      versionPr: {
        base: "main",
      },
    }),
  ],
});

await runCli(paper);
