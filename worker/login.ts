import { chromium } from "playwright";
import path from "path";

const SESSION_DIR = path.resolve(__dirname, "../.jimeng-session");

async function main() {
  console.log(`[login] Session dir: ${SESSION_DIR}`);
  console.log("[login] Launching browser...");

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--start-maximized"],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://jimeng.jianying.com");
  console.log("[login] Browser opened! Please log in to 即梦, then press Ctrl+C.");

  // Keep alive
  await new Promise<void>(() => {});
}

main().catch((err) => {
  console.error("Launch failed:", err);
  process.exit(1);
});
