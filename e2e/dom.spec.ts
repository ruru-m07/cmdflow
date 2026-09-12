import { expect, test } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:4322";

test.beforeEach(async ({ page }) => {
  await page.goto(fixtureUrl);
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
});

test("native dialog contains focus, preserves virtual navigation, and restores opener", async ({
  page,
}) => {
  const opener = page.getByRole("button", { name: "Open commands", exact: true });
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Native command palette", exact: true });
  const input = page.getByRole("combobox", { name: "Search commands", exact: true });
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.getByRole("option", { name: "Alpha", exact: true })).not.toHaveAttribute(
    "aria-selected",
  );
  await input.press("ArrowDown");
  const disabled = page.getByRole("option", { name: /Beta/ });
  await expect(disabled).toHaveAttribute("aria-disabled", "true");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    (await disabled.getAttribute("id")) ?? "missing",
  );
  await input.press("Enter");
  expect(await page.evaluate(() => window.cmdflowFixture.runs())).toEqual([]);
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.cmdflowFixture.runs())).toEqual(["gamma"]);
  const close = page.getByRole("button", { name: "Close command palette", exact: true });
  await close.focus();
  await close.press("Tab");
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("contextual actions and nested action pages retain the main frame and layer focus", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open commands", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Search commands", exact: true });
  await input.fill("alpha");
  const trigger = page.getByRole("button", { name: "Actions", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const actionInput = page.getByRole("combobox", { name: "Search actions", exact: true });
  await expect(actionInput).toBeFocused();
  await actionInput.fill("more");
  await actionInput.press("Enter");
  await expect(page.getByRole("option", { name: "Nested action", exact: true })).toBeVisible();
  await actionInput.press("Escape");
  await expect(actionInput).toHaveValue("more");
  await expect(input).toHaveValue("alpha");
  await actionInput.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(input).toHaveValue("alpha");
});

test("confirmation makes background controls inert and restores the actions input", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open commands", exact: true }).click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  const actions = page.getByRole("combobox", { name: "Search actions", exact: true });
  await actions.fill("delete");
  await actions.press("Enter");
  const confirmation = page.getByRole("alertdialog", { name: "Delete Alpha?", exact: true });
  await expect(confirmation).toBeFocused();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await confirmation.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expect(actions).toBeFocused();
  expect(await page.evaluate(() => window.cmdflowFixture.runs())).toEqual([]);
});

test("pointer actions opener is restored even when clicked buttons do not receive focus", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open commands", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Search commands", exact: true });
  await expect(input).toBeFocused();
  const trigger = page.getByRole("button", { name: "Actions", exact: true });
  await trigger.click();
  const actions = page.getByRole("combobox", { name: "Search actions", exact: true });
  await expect(actions).toBeFocused();
  await actions.press("Escape");
  await expect(trigger).toBeFocused();
});

test("controlled native Escape and cancel request closure without closing early", async ({
  page,
}) => {
  await page.goto(`${fixtureUrl}/?controlled=true`);
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Open commands", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Native command palette", exact: true });
  const input = page.getByRole("combobox", { name: "Search commands", exact: true });
  await input.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.cmdflowFixture.closeRequests())).toBe(1);
  expect(await page.evaluate(() => window.cmdflowFixture.cancelNative())).toBe(true);
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.cmdflowFixture.acceptClose());
  await input.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("synthetic composition uses real browser dispatch without invoking or closing", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open commands", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Search commands", exact: true });
  await input.dispatchEvent("compositionstart", { data: "あ" });
  await input.evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = "alpha";
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        isComposing: true,
        inputType: "insertCompositionText",
      }),
    );
  });
  await input.press("Enter");
  await input.press("Escape");
  await input.press("ArrowDown");
  expect(await page.evaluate(() => window.cmdflowFixture.runs())).toEqual([]);
  expect(await page.evaluate(() => window.cmdflowFixture.snapshot().open)).toBe(true);
  await input.dispatchEvent("compositionend", { data: "alpha" });
  await expect(page.getByRole("option", { name: "Alpha", exact: true })).toBeVisible();
  await expect(input).toHaveValue("alpha");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.cmdflowFixture.runs())).toEqual(["alpha"]);
});

for (const scope of ["shadow", "iframe"]) {
  test(`${scope} owner realm supports modal focus and active-descendant references`, async ({
    page,
  }) => {
    await page.goto(`${fixtureUrl}/?scope=${scope}`);
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    const root = scope === "iframe" ? page.frameLocator("iframe") : page;
    const opener = root.getByRole("button", { name: "Open commands", exact: true });
    await opener.focus();
    await opener.press("Enter");
    const input = root.getByRole("combobox", { name: "Search commands", exact: true });
    await expect(input).toBeFocused();
    await input.press("ArrowDown");
    const beta = root.getByRole("option", { name: /Beta/ });
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      (await beta.getAttribute("id")) ?? "missing",
    );
    await input.press("Escape");
    await expect(opener).toBeFocused();
  });
}

test("destroy releases dialog, document shortcuts and focus ownership", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open commands", exact: true });
  await opener.focus();
  await opener.press("Enter");
  await page.evaluate(() => window.cmdflowFixture.destroy());
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.press("Control+j");
  expect(await page.evaluate(() => window.cmdflowFixture.snapshot().open)).toBe(false);
  expect(await page.evaluate(() => window.cmdflowFixture.snapshot().destroyed)).toBe(true);
});
