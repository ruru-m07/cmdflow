"use client";

import { type CmdFlow, createCmdFlow, defineView } from "@cmdflow/react";
import { createIndexedDBRankingStore } from "@cmdflow/react/persistence";
import { useEffect, useRef, useState } from "react";
import { githubCommands } from "./commands";
import { pullRequestSource } from "./source";
import type { GithubContext, GithubItemData } from "./types";

interface GithubRuntime {
  readonly flow: CmdFlow<GithubContext, GithubItemData>;
  destroy(): void;
}

function createGithubRuntime(): GithubRuntime {
  const ranking = createIndexedDBRankingStore({
    databaseName: "cmdflow-github-example-v1",
    queryRetention: "fingerprint",
  });
  const flow = createCmdFlow<GithubContext, GithubItemData>({
    id: "github-example",
    root: defineView({
      id: "commands",
      type: "list",
      title: "Commands",
      sourceIds: [],
    }),
    commands: githubCommands,
    sources: [pullRequestSource],
    ranking: {
      store: ranking,
      scope: { subjectKey: "local-user", surfaceId: "command-palette" },
      queryPolicy: (scope) => ranking.getQueryPolicy(scope),
    },
  });

  return {
    flow,
    destroy() {
      flow.destroy();
      ranking.destroy();
    },
  };
}

export function useGithubFlow(): CmdFlow<GithubContext, GithubItemData> {
  const [runtime] = useState(createGithubRuntime);
  const leases = useRef(0);

  useEffect(() => {
    leases.current += 1;
    return () => {
      leases.current -= 1;
      queueMicrotask(() => {
        if (leases.current === 0) runtime.destroy();
      });
    };
  }, [runtime]);

  return runtime.flow;
}
