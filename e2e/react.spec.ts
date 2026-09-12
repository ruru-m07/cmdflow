import { expect, type Page, test } from "@playwright/test";

const failures = new WeakMap<Page, string[]>();
const search = (page: Page) => page.getByRole("combobox", { name: "Search commands", exact: true });
const panel = (page: Page) =>
  page.getByRole("dialog", { name: "CmdFlow command palette", exact: true });
const mainList = (page: Page) => panel(page).getByRole("listbox").first();
const open = async (page: Page) => {
  await page.getByRole("button", { name: /Open command panel/ }).click();
  await expect(search(page)).toBeFocused();
};

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Open command panel/ })).toBeEnabled();
});
test.afterEach(({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

test("sixth GitHub choice is learned locally and survives a full reload", async ({ page }) => {
  await open(page);
  await search(page).fill("github");
  const options = mainList(page).getByRole("option");
  await expect(options).toHaveCount(10);
  await expect(options.nth(5)).toContainText("Notifications");
  for (let i = 0; i < 5; i++) await search(page).press("ArrowDown");
  await expect(search(page)).toHaveAttribute(
    "aria-activedescendant",
    (await options.nth(5).getAttribute("id")) ?? "missing",
  );
  await search(page).press("Enter");
  await expect(panel(page)).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Ran GitHub · Notifications");
  await open(page);
  await expect(options.first()).toContainText("Notifications");
  await page.reload();
  await open(page);
  await search(page).fill("github");
  await expect(mainList(page).getByRole("option").first()).toContainText("Notifications");
  await search(page).press("Escape");
  await search(page).press("Escape");
  await page.getByRole("button", { name: "Reset learning", exact: true }).click();
  await open(page);
  await search(page).fill("github");
  await expect(mainList(page).getByRole("option").nth(5)).toContainText("Notifications");
});

test("contextual search/submenus and destructive confirmation preserve the main query", async ({
  page,
}) => {
  await open(page);
  await search(page).fill("github");
  await search(page).press("ControlOrMeta+k");
  const actions = page.getByRole("combobox", { name: "Search actions", exact: true });
  await expect(actions).toBeFocused();
  await actions.fill("organize");
  await actions.press("Enter");
  await expect(page.getByRole("option", { name: "Preview pin action", exact: true })).toBeVisible();
  await actions.press("Escape");
  await expect(actions).toHaveValue("organize");
  await actions.fill("removal");
  await actions.press("Enter");
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(actions).toBeFocused();
  await expect(actions).toHaveValue("removal");
  await actions.press("Escape");
  await expect(search(page)).toHaveValue("github");
});

test("native forms validate, retain canceled drafts, and submit without a discard prompt", async ({
  page,
}) => {
  await open(page);
  await search(page).fill("create pull request");
  await mainList(page)
    .getByRole("option")
    .filter({ hasText: "GitHub · Create pull request" })
    .click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toBeFocused();
  await title.fill("abc");
  await page.getByRole("button", { name: "Create pull request", exact: true }).click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Use at least five characters for a useful title.", { exact: true }),
  ).toBeVisible();
  await title.fill("Preserve command state");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("A draft that should survive canceled navigation.");
  await page.getByRole("combobox", { name: "Base branch", exact: true }).selectOption("develop");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(title).toHaveValue("Preserve command state");
  await page.getByRole("button", { name: "Create pull request", exact: true }).click();
  await expect(search(page)).toBeFocused();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(search(page)).toHaveValue("create pull request");
});

test("async pages, isolated error recovery, detail navigation and back preserve query", async ({
  page,
}) => {
  await open(page);
  await search(page).fill("my pull requests");
  await mainList(page).getByRole("option").filter({ hasText: "GitHub · My pull requests" }).click();
  await expect(mainList(page).getByRole("option")).toHaveCount(3);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(mainList(page).getByRole("option")).toHaveCount(6);
  await page.getByRole("button", { name: "Simulate error", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("The demo source failed");
  await page.getByRole("button", { name: "Retry source", exact: true }).click();
  await expect(mainList(page).getByRole("option")).toHaveCount(3);
  await search(page).fill("focus");
  await expect(mainList(page).getByRole("option")).toHaveCount(1);
  await search(page).press("Enter");
  await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("focus");
});

test("panel remains usable at narrow viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await search(page).fill("github");
  const bounds = await panel(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.width ?? 0) + (bounds?.x ?? 0)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await search(page).press("ControlOrMeta+k");
  await expect(page.getByRole("combobox", { name: "Search actions", exact: true })).toBeFocused();
});
