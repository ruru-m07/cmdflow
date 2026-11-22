export type GithubItemKind = "application" | "command" | "quicklink" | "pull-request";

export interface GithubItemData {
  readonly kind: GithubItemKind;
  /** Glyph, or an id registered with `registerCommandIcon`. The snapshot cannot hold a component. */
  readonly icon: string;
  readonly accessory: string;
  readonly number?: number;
}

export type GithubContext = Record<string, never>;
