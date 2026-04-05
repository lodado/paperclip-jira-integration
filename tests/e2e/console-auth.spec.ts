import { test, expect } from "@playwright/test";

test("redirects home to login when console auth is enabled", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("BVA: empty password shows validation from API", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toContainText("required");
});

test("negative partition: wrong password shows actionable error", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toContainText("not correct");
});

test("EP: valid login reaches home and session survives reload", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-console-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Jira poll")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Jira poll")).toBeVisible();
});

test("keyboard: submit via Enter signs in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("e2e-console-pass");
  await page.getByLabel("Password").press("Enter");
  await expect(page).toHaveURL("/");
});

test("async race: parallel login requests both succeed; session cookie works", async ({
  page,
}) => {
  await page.goto("/login");
  const statuses = await page.evaluate(async () => {
    const body = JSON.stringify({ password: "e2e-console-pass" });
    const responses = await Promise.all([
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ]);
    return responses.map((r) => r.status);
  });
  expect(statuses).toEqual([200, 200]);

  await page.goto("/");
  await expect(page.getByText("Jira poll")).toBeVisible();
});
