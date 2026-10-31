import { expect, type Page, test } from "@playwright/test";

const failures = new WeakMap<Page, string[]>();
const search = (page: Page) => page.getByRole("combobox", { name: "Search commands", exact: true });
const panel = (page: Page) => page.getByRole("dialog", { name: "CmdFlow live demo", exact: true });
const mainList = (page: Page) => panel(page).getByRole("listbox").first();
const open = async (page: Page) => {
  await page.getByRole("button", { name: /Open Command Palette/ }).click();
  await expect(search(page)).toBeFocused();
};

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Open Command Palette/ })).toBeEnabled();
});
test.afterEach(({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

test("a GitHub choice is learned locally and survives a full reload", async ({ page }) => {
  await open(page);
  await search(page).fill("github");
  const options = mainList(page).getByRole("option");
  await expect(options).toHaveCount(10);
  const coldOrder = await options.allTextContents();
  const notification = options.filter({ hasText: "GitHub · Notifications" });
  await expect(notification).toHaveCount(1);
  await notification.click();
  await expect(panel(page)).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Ran GitHub · Notifications");
  await open(page);
  await expect(
    mainList(page).getByRole("option").filter({ hasText: "GitHub · Notifications" }),
  ).toHaveAttribute("aria-posinset", "1");
  await page.reload();
  await open(page);
  await search(page).fill("github");
  await expect(
    mainList(page).getByRole("option").filter({ hasText: "GitHub · Notifications" }),
  ).toHaveAttribute("aria-posinset", "1");
  await panel(page).getByRole("button", { name: "Close command palette", exact: true }).click();
  await page.getByRole("button", { name: "Reset Learning", exact: true }).click();
  await expect(page.locator("#demo-status")).toHaveText(
    "Cleared the locally learned command order.",
  );
  await page.reload();
  await open(page);
  await search(page).fill("github");
  await expect.poll(() => mainList(page).getByRole("option").allTextContents()).toEqual(coldOrder);
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
  const cancel = confirmation.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
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
  await page.getByRole("button", { name: "Create Pull Request", exact: true }).click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Use at least five characters for a useful title.", { exact: true }),
  ).toBeVisible();
  await title.fill("Preserve command state");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("A draft that should survive canceled navigation.");
  await page.getByRole("combobox", { name: "Base branch", exact: true }).selectOption("develop");
  const formBack = panel(page)
    .locator("form")
    .getByRole("button", { name: "Go back", exact: true });
  await expect(formBack).toHaveText("Cancel");
  await formBack.click();
  const discardConfirmation = page.getByRole("alertdialog");
  await expect(discardConfirmation).toBeVisible();
  await discardConfirmation.getByRole("button", { name: "Keep Editing", exact: true }).click();
  await expect(title).toHaveValue("Preserve command state");
  await page.getByRole("button", { name: "Create Pull Request", exact: true }).click();
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
  await page.getByRole("button", { name: "Load More", exact: true }).click();
  await expect(mainList(page).getByRole("option")).toHaveCount(6);
  await page.getByRole("button", { name: "Simulate Error", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("The demo source failed");
  await page.getByRole("button", { name: "Retry Source", exact: true }).click();
  await expect(mainList(page).getByRole("option")).toHaveCount(3);
  await search(page).fill("focus");
  await expect(mainList(page).getByRole("option")).toHaveCount(1);
  await search(page).press("Enter");
  await page.getByRole("button", { name: "Mark Reviewed", exact: true }).click();
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
