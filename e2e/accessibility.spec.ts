import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

const search = (page: Page) => page.getByRole("combobox", { name: "Search commands", exact: true });

async function audit(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await testInfo.attach(`axe-${state}`, {
    body: JSON.stringify(
      {
        url: results.url,
        state,
        violations: results.violations,
        incomplete: results.incomplete,
        passedRuleCount: results.passes.length,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  const details = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      html: node.html,
      summary: node.failureSummary,
    })),
  }));
  expect(results.violations, JSON.stringify(details, null, 2)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Open command panel/ }).click();
  await expect(search(page)).toBeFocused();
});

test("main React panel satisfies automated WCAG 2.1 A/AA checks", async ({ page }, testInfo) => {
  await search(page).fill("github");
  await expect(page.getByRole("option")).toHaveCount(10);
  await audit(page, testInfo, "main");
});

test("searchable contextual actions satisfy automated WCAG 2.1 A/AA checks", async ({
  page,
}, testInfo) => {
  await search(page).fill("github");
  await search(page).press("ControlOrMeta+k");
  await expect(page.getByRole("combobox", { name: "Search actions", exact: true })).toBeFocused();
  await audit(page, testInfo, "contextual-actions");
});

test("native form and inline validation satisfy automated WCAG 2.1 A/AA checks", async ({
  page,
}, testInfo) => {
  await search(page).fill("create pull request");
  await page.getByRole("option").filter({ hasText: "GitHub · Create pull request" }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toBeFocused();
  await audit(page, testInfo, "form");
  await title.fill("abc");
  await page.getByRole("button", { name: "Create pull request", exact: true }).click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await audit(page, testInfo, "form-validation-error");
});

test("destructive confirmation satisfies automated WCAG 2.1 A/AA checks", async ({
  page,
}, testInfo) => {
  await search(page).fill("github");
  await search(page).press("ControlOrMeta+k");
  const actions = page.getByRole("combobox", { name: "Search actions", exact: true });
  await actions.fill("removal");
  await actions.press("Enter");
  await expect(page.getByRole("alertdialog")).toBeFocused();
  await audit(page, testInfo, "destructive-confirmation");
});
