import { test, expect } from "@playwright/test";

// Smoke test: visit /login directly (skips the auth-check redirect from /),
// confirm the public login screen renders, and assert no uncaught console
// errors fired. Catches Vite/bundle regressions, broken imports, and React
// runtime crashes — the cheapest signal that the app is at least bootable.
test("login page renders without console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(err.message);
  });

  await page.goto("/login");

  // Branding + heading + sign-in CTA all present.
  await expect(page.getByRole("heading", { name: "Orbit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sign in with microsoft/i }),
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
