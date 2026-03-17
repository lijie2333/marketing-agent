import { BrowserContext, Page, chromium } from "playwright";
import path from "path";

const JIMENG_URL = "https://jimeng.jianying.com/ai-tool/video/generate";
const SESSION_DIR = path.join(__dirname, "../.jimeng-session");

export class JimengAutomation {
  private context: BrowserContext | null = null;

  async init() {
    this.context = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  }

  async generateVideo(params: {
    content: string;
    duration: number;
    ratio: string;
  }): Promise<string | null> {
    if (!this.context) throw new Error("Not initialized");

    const page = await this.context.newPage();
    try {
      await page.goto(JIMENG_URL, { waitUntil: "networkidle", timeout: 30000 });

      const input = await this.findInputField(page);
      if (!input) throw new Error("Input field not found on 即梦 page");

      await input.click();
      await input.fill("");
      await page.waitForTimeout(300);
      await input.fill(params.content);
      await page.waitForTimeout(500);

      const generateBtn = page
        .locator('button:has-text("生成"), [class*="generate"]:has-text("生成")')
        .first();
      await generateBtn.click();

      const videoUrl = await this.waitForVideoUrl(page, 5 * 60 * 1000);
      return videoUrl;
    } finally {
      await page.close();
    }
  }

  private async findInputField(page: Page) {
    // Try contenteditable first (即梦 uses rich text editor, per 即梦批量生成助手.html)
    const contenteditable = page.locator('[contenteditable="true"]').first();
    if (await contenteditable.isVisible().catch(() => false)) return contenteditable;

    // Fallback: textarea with relevant placeholder
    const textarea = page
      .locator(
        'textarea[placeholder*="描述"], textarea[placeholder*="输入"], textarea[placeholder*="想"]'
      )
      .first();
    if (await textarea.isVisible().catch(() => false)) return textarea;

    return null;
  }

  private async waitForVideoUrl(
    page: Page,
    timeoutMs: number
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000);

      // Check for video element
      const videoEl = page.locator("video[src]").first();
      if (await videoEl.isVisible().catch(() => false)) {
        const src = await videoEl.getAttribute("src");
        if (src) return src;
      }

      // Check for download button (generation complete signal)
      const downloadBtn = page
        .locator('[class*="download"], button:has-text("下载")')
        .first();
      if (await downloadBtn.isVisible().catch(() => false)) {
        await downloadBtn.hover();
        await page.waitForTimeout(500);
        const video = page.locator("video").first();
        const src = await video.getAttribute("src").catch(() => null);
        if (src) return src;
      }
    }
    return null;
  }

  async close() {
    await this.context?.close();
  }
}
