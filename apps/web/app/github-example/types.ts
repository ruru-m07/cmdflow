export type GithubItemKind = "application" | "command" | "quicklink" | "pull-request";

export interface GithubItemData {
  readonly kind: GithubItemKind;
  readonly icon: string;
  readonly accessory: string;
  readonly number?: number;
}

export type GithubContext = Record<string, never>;
