import { expect, type Page, test } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
const search = (page: Page) =>
  page.getByRole("combobox", { name: "Search Solid commands", exact: true });
const actions = (page: Page) =>
  page.getByRole("combobox", { name: "Search Solid actions", exact: true });
const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Solid command palette", exact: true });

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("http://127.0.0.1:4322/solid");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test("Solid mounts native elements and routes query, keyboard navigation and invocation through core", async ({
  page,
}) => {
  const opener = page.getByRole("button", { name: "Open Solid commands", exact: true });
  await opener.focus();
  await opener.press("Enter");
  await expect(panel(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
  const disabled = page.getByRole("option", { name: "Beta", exact: true });
  await search(page).press("ArrowDown");
  await expect(disabled).toHaveAttribute("aria-disabled", "true");
  await expect(search(page)).toHaveAttribute(
    "aria-activedescendant",
    (await disabled.getAttribute("id")) ?? "missing",
  );
  await search(page).press("Enter");
  expect(await page.evaluate(() => window.cmdflowSolidFixture.runs())).toEqual([]);
  await search(page).press("ArrowDown");
  await search(page).press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.cmdflowSolidFixture.runs()))
    .toEqual(["gamma"]);
  await search(page).fill("alpha");
  await expect(panel(page).getByRole("option")).toHaveCount(1);
  await search(page).press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.cmdflowSolidFixture.runs()))
    .toEqual(["gamma", "alpha"]);
  await search(page).press("Escape");
  await search(page).press("Escape");
  await expect(panel(page)).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("Solid contextual submenus and destructive confirmation preserve both search surfaces", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open Solid commands", exact: true }).click();
  await search(page).fill("alpha");
  await search(page).press("ControlOrMeta+k");
  await expect(actions(page)).toBeFocused();
  await actions(page).fill("more");
  await actions(page).press("Enter");
  await expect(page.getByRole("option", { name: "Nested action", exact: true })).toBeVisible();
  await actions(page).press("Escape");
  await expect(actions(page)).toHaveValue("more");
  await expect(search(page)).toHaveValue("alpha");
  await actions(page).fill("delete");
  await actions(page).press("Enter");
  const confirmation = page.getByRole("alertdialog", { name: "Delete Alpha?", exact: true });
  await expect(confirmation).toBeFocused();
  expect(await page.evaluate(() => window.cmdflowSolidFixture.runs())).toEqual([]);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(actions(page)).toBeFocused();
  await expect(actions(page)).toHaveValue("delete");
  await actions(page).press("Enter");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.cmdflowSolidFixture.runs()))
    .toEqual(["delete"]);
  await expect(confirmation).not.toBeVisible();
  await actions(page).press("Escape");
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("alpha");
});

test("Solid native forms validate, retain canceled drafts, and return to the previous query", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open Solid commands", exact: true }).click();
  await search(page).fill("report");
  await search(page).press("Enter");
  const title = page.getByRole("textbox", { name: "Report title", exact: true });
  await expect(title).toBeFocused();
  await title.fill("abc");
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Use at least four characters.", { exact: true })).toBeVisible();
  await title.fill("Solid release report");
  await page
    .getByRole("textbox", { name: "Report description", exact: true })
    .fill("A preserved draft");
  await page.getByRole("combobox", { name: "Report branch", exact: true }).selectOption("develop");
  await page.getByRole("button", { name: "Cancel report", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(title).toHaveValue("Solid release report");
  await expect(page.getByRole("textbox", { name: "Report description", exact: true })).toHaveValue(
    "A preserved draft",
  );
  await expect(page.getByRole("combobox", { name: "Report branch", exact: true })).toHaveValue(
    "develop",
  );
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("report");
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  expect(await page.evaluate(() => window.cmdflowSolidFixture.runs())).toEqual([
    "report:Solid release report:develop",
  ]);
});

test("Solid disposal releases the subscription and document shortcut without destroying host state", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open Solid commands", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.cmdflowSolidFixture.subscriptions())).toBe(1);
  await search(page).press("Escape");
  await page.evaluate(() => window.cmdflowSolidFixture.disposeView());
  await expect(page.locator("#solid-fixture")).toBeEmpty();
  expect(await page.evaluate(() => window.cmdflowSolidFixture.subscriptions())).toBe(0);
  await page.keyboard.press("Control+j");
  expect(await page.evaluate(() => window.cmdflowSolidFixture.snapshot().open)).toBe(false);
  expect(await page.evaluate(() => window.cmdflowSolidFixture.snapshot().destroyed)).toBe(false);
  await page.evaluate(() => window.cmdflowSolidFixture.destroy());
  expect(await page.evaluate(() => window.cmdflowSolidFixture.snapshot().destroyed)).toBe(true);
});
