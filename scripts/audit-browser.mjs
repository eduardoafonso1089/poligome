import { chromium } from "playwright";

/**
 * Launch the audit browser.
 *
 * CI runs `npx playwright install chromium`, which puts the exact build this
 * Playwright expects where it looks for it, and this resolves to the default.
 * A machine that already carries a Chromium from a different Playwright release
 * — a preinstalled image, another project's cache — would otherwise fail with
 * "Executable doesn't exist", so PLAYWRIGHT_CHROMIUM_EXECUTABLE points at it.
 */
export function launchAuditBrowser(options = {}) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath, args: ["--no-sandbox", ...(options.args ?? [])] } : {}),
    ...options,
  });
}
