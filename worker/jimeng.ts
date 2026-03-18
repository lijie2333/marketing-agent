import { BrowserContext, Page, chromium } from "playwright";
import path from "path";

const JIMENG_URL = "https://jimeng.jianying.com/ai-tool/video/generate";
const SESSION_DIR = path.join(__dirname, "../.jimeng-session");

// Known non-result URLs to filter out (loading animations, static assets)
const URL_BLACKLIST = [
  "loading-animation",
  "record-loading",
  "static/media",
  "vlabstatic.com/obj/image-lvweb-buz",
  "placeholder",
  "preview-thumb",
];

/** Error thrown when 即梦 rejects a prompt due to content review */
export class ContentReviewError extends Error {
  constructor(public reviewMessage: string) {
    super(`即梦提示词审核不通过: ${reviewMessage}`);
    this.name = "ContentReviewError";
  }
}

export class JimengAutomation {
  private context: BrowserContext | null = null;

  async init() {
    this.context = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: process.env.HEADLESS !== "false",
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  }

  async generateVideo(params: {
    content: string;
    duration: number;
    ratio: string;
  }): Promise<string> {
    if (!this.context) throw new Error("Not initialized");

    // Reuse existing page or create new one
    const pages = this.context.pages();
    const page = pages.length > 0 ? pages[0] : await this.context.newPage();

    try {
      console.log(`[jimeng] Navigating to ${JIMENG_URL}`);
      await page.goto(JIMENG_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(5000);

      // Step 1: Configure video parameters (ratio, resolution, duration)
      await this.configureVideoParams(page, params);

      // Step 2: Find and fill input using React-compatible injection
      console.log("[jimeng] Filling prompt text...");
      const fillResult = await page.evaluate((text: string) => {
        /* ===== 文本填充（3重策略，来自即梦批量生成助手） ===== */
        function fillText(el: Element, text: string) {
          const htmlEl = el as HTMLElement;
          htmlEl.focus();

          // 先清空
          if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
            (el as HTMLInputElement).select();
          } else {
            try { document.execCommand("selectAll", false, undefined); } catch (e) {}
          }

          // 策略1: execCommand insertText
          let ok = false;
          try { ok = document.execCommand("insertText", false, text); } catch (e) {}
          const cur = (el as HTMLInputElement).value !== undefined
            ? (el as HTMLInputElement).value
            : el.textContent;
          if (ok && cur && cur.indexOf(text) > -1) return true;

          // 策略2: React synthetic setter
          if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
            const proto = el.tagName === "TEXTAREA"
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
            if (descriptor && descriptor.set) {
              descriptor.set.call(el, text);
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }

          // 策略3: 直接设置
          el.textContent = text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }

        // 查找输入框
        const textareas = document.querySelectorAll("textarea");
        for (let i = 0; i < textareas.length; i++) {
          const ta = textareas[i];
          if (ta.offsetWidth > 100 && ta.offsetHeight > 30) {
            fillText(ta, text);
            return { success: true, type: "textarea" };
          }
        }
        const editables = document.querySelectorAll('[contenteditable="true"]');
        for (let i = 0; i < editables.length; i++) {
          const el = editables[i] as HTMLElement;
          if (el.offsetWidth > 100 && el.offsetHeight > 20) {
            fillText(el, text);
            return { success: true, type: "contenteditable" };
          }
        }
        return { success: false, error: "未找到输入框" };
      }, params.content);

      console.log(`[jimeng] Fill result:`, fillResult);
      if (!fillResult.success) {
        throw new Error(fillResult.error || "未找到输入框");
      }

      await page.waitForTimeout(800);

      // Step 3: Click submit button using Playwright native click (safer, no parent propagation)
      console.log("[jimeng] Looking for submit button...");
      let clicked = false;

      // Try 1: Primary icon-only button (即梦的圆形提交按钮)
      const iconBtn = page.locator("button.lv-btn-primary.lv-btn-icon-only").first();
      if (await iconBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        if (!(await iconBtn.isDisabled().catch(() => true))) {
          console.log("[jimeng] Clicking primary icon button...");
          await iconBtn.click();
          clicked = true;
        }
      }

      // Try 2: Any primary button
      if (!clicked) {
        const primaryBtn = page.locator("button.lv-btn-primary").first();
        if (await primaryBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          if (!(await primaryBtn.isDisabled().catch(() => true))) {
            console.log("[jimeng] Clicking primary button...");
            await primaryBtn.click();
            clicked = true;
          }
        }
      }

      // Try 3: Button with "生成" text
      if (!clicked) {
        const genBtn = page.locator('button:has-text("生成")').first();
        if (await genBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log("[jimeng] Clicking 生成 button...");
          await genBtn.click();
          clicked = true;
        }
      }

      // Fallback: press Enter in the input
      if (!clicked) {
        console.log("[jimeng] No button found, pressing Enter...");
        const textarea = page.locator("textarea").first();
        if (await textarea.isVisible().catch(() => false)) {
          await textarea.press("Enter");
        }
        clicked = true;
      }

      console.log(`[jimeng] Submit done (clicked=${clicked})`);

      // Step 4: Brief wait then check for immediate rejection (审核不通过)
      await page.waitForTimeout(3000);
      await this.checkContentReview(page);

      // Step 5: Wait for video generation (up to 5 minutes)
      console.log("[jimeng] Waiting for video generation (up to 5 minutes)...");
      const videoUrl = await this.waitForVideoUrl(page, 5 * 60 * 1000);
      console.log(`[jimeng] Video URL obtained: ${videoUrl.substring(0, 80)}...`);
      return videoUrl;
    } catch (err) {
      // Don't close the page on error — leave it for debugging
      console.error("[jimeng] Error:", err);
      throw err;
    }
    // NOTE: We do NOT close the page. It stays open for the next job.
    // The persistent context reuses pages across jobs.
  }

  /**
   * Configure video parameters: 9:16 ratio, 1080P resolution, target duration.
   * Uses page.evaluate ONLY to locate elements (get coordinates), then uses
   * Playwright native page.mouse.click() to avoid triggering unwanted navigation.
   */
  private async configureVideoParams(
    page: Page,
    params: { duration: number; ratio: string }
  ): Promise<void> {
    const targetRatio = params.ratio || "9:16";
    const targetDuration = params.duration || 15;
    console.log(`[jimeng] Configuring: ratio=${targetRatio}, resolution=1080P, duration=${targetDuration}s`);

    // --- Step A: Open ratio/resolution panel ---
    const ratioBtn = await page.evaluate(() => {
      const els = document.querySelectorAll("*");
      for (const el of els) {
        const text = (el as HTMLElement).innerText?.trim();
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.top > 700 && text && /\d+:\d+/.test(text) && /\d+P/.test(text) && rect.width < 200 && rect.height < 50) {
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text };
        }
      }
      return null;
    });

    if (ratioBtn) {
      console.log(`[jimeng] Found ratio button: "${ratioBtn.text}" at (${ratioBtn.x}, ${ratioBtn.y})`);
      await page.mouse.click(ratioBtn.x, ratioBtn.y);
      await page.waitForTimeout(800);

      // Click the target ratio (e.g. "9:16")
      const ratioOpt = await page.evaluate((target: string) => {
        const els = document.querySelectorAll("*");
        for (const el of els) {
          if (el.children.length === 0 && el.textContent?.trim() === target) {
            const rect = (el as HTMLElement).getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
        }
        return null;
      }, targetRatio);

      if (ratioOpt) {
        await page.mouse.click(ratioOpt.x, ratioOpt.y);
        console.log(`[jimeng] Selected ratio: ${targetRatio}`);
      } else {
        console.log(`[jimeng] Ratio option "${targetRatio}" not found`);
      }
      await page.waitForTimeout(500);

      // Click 1080P
      const resOpt = await page.evaluate(() => {
        const els = document.querySelectorAll("*");
        for (const el of els) {
          const text = el.textContent?.trim();
          if (text && /^1080P/.test(text) && el.children.length <= 1) {
            const rect = (el as HTMLElement).getBoundingClientRect();
            if (rect.width > 20 && rect.height > 10) {
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
        }
        return null;
      });

      if (resOpt) {
        await page.mouse.click(resOpt.x, resOpt.y);
        console.log("[jimeng] Selected resolution: 1080P");
      } else {
        console.log("[jimeng] Resolution option 1080P not found");
      }
      await page.waitForTimeout(500);

      // Close panel by clicking the textarea area
      const textareaPos = await page.evaluate(() => {
        const ta = document.querySelector("textarea") || document.querySelector("[contenteditable='true']");
        if (ta) {
          const rect = (ta as HTMLElement).getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        return null;
      });
      if (textareaPos) {
        await page.mouse.click(textareaPos.x, textareaPos.y);
      }
      await page.waitForTimeout(300);
    } else {
      console.log("[jimeng] Ratio/resolution button not found in toolbar");
    }

    // --- Step B: Open duration panel ---
    const durBtn = await page.evaluate(() => {
      const els = document.querySelectorAll("*");
      for (const el of els) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const text = (el as HTMLElement).innerText?.trim();
        if (rect.top > 700 && text && /^\d+s$/.test(text) && rect.width < 80 && rect.height < 40) {
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text };
        }
      }
      return null;
    });

    if (durBtn) {
      console.log(`[jimeng] Found duration button: "${durBtn.text}" at (${durBtn.x}, ${durBtn.y})`);
      await page.mouse.click(durBtn.x, durBtn.y);
      await page.waitForTimeout(800);

      // Click target duration
      const targetText = `${targetDuration}s`;
      const durOpt = await page.evaluate((targets: string[]) => {
        const els = document.querySelectorAll("*");
        for (const target of targets) {
          for (const el of els) {
            if (el.children.length === 0 && el.textContent?.trim() === target) {
              const rect = (el as HTMLElement).getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: target };
              }
            }
          }
        }
        return null;
      }, [targetText, String(targetDuration)]);

      if (durOpt) {
        await page.mouse.click(durOpt.x, durOpt.y);
        console.log(`[jimeng] Selected duration: ${durOpt.text}`);
      } else {
        console.log(`[jimeng] Duration option "${targetText}" not found`);
      }
      await page.waitForTimeout(500);

      // Close panel
      const textareaPos2 = await page.evaluate(() => {
        const ta = document.querySelector("textarea") || document.querySelector("[contenteditable='true']");
        if (ta) {
          const rect = (ta as HTMLElement).getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        return null;
      });
      if (textareaPos2) {
        await page.mouse.click(textareaPos2.x, textareaPos2.y);
      }
      await page.waitForTimeout(300);
    } else {
      console.log("[jimeng] Duration button not found in toolbar");
    }

    // --- Verify ---
    const finalBar = await page.evaluate(() => {
      const els = document.querySelectorAll("*");
      for (const el of els) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const text = (el as HTMLElement).innerText?.trim();
        if (rect.top > 700 && text && /\d+:\d+/.test(text) && /\d+P/.test(text)) {
          return text;
        }
      }
      return "";
    });
    const finalDur = await page.evaluate(() => {
      const els = document.querySelectorAll("*");
      for (const el of els) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const text = (el as HTMLElement).innerText?.trim();
        if (rect.top > 700 && text && /^\d+s$/.test(text) && rect.width < 80) {
          return text;
        }
      }
      return "";
    });
    console.log(`[jimeng] Final config: ${finalBar} | ${finalDur}`);
  }

  /**
   * Check if 即梦 rejected the prompt due to content review (审核不通过).
   * Scans for common rejection UI patterns on the page.
   */
  private async checkContentReview(page: Page): Promise<void> {
    const rejection = await page.evaluate(() => {
      // Common rejection patterns in 即梦 UI
      const rejectKeywords = [
        "审核不通过", "内容违规", "不合规", "违反", "敏感内容",
        "无法生成", "内容审核", "生成失败", "包含违禁", "不支持生成",
        "触发安全", "安全审核", "内容不合规",
      ];

      // Check toast / notification messages
      const toasts = document.querySelectorAll(
        ".lv-message, .lv-notification, .lv-toast, [class*='toast'], [class*='message'], [class*='notice'], [class*='alert'], [role='alert']"
      );
      for (const el of toasts) {
        const text = (el as HTMLElement).innerText || "";
        for (const kw of rejectKeywords) {
          if (text.includes(kw)) {
            return text.trim().substring(0, 200);
          }
        }
      }

      // Check modal / dialog
      const modals = document.querySelectorAll(
        ".lv-modal, [class*='modal'], [class*='dialog'], [role='dialog']"
      );
      for (const el of modals) {
        const text = (el as HTMLElement).innerText || "";
        for (const kw of rejectKeywords) {
          if (text.includes(kw)) {
            return text.trim().substring(0, 200);
          }
        }
      }

      // Check any visible error-styled elements
      const errorEls = document.querySelectorAll(
        "[class*='error'], [class*='fail'], [class*='reject'], [class*='warning']"
      );
      for (const el of errorEls) {
        const text = (el as HTMLElement).innerText || "";
        if (text.length > 2 && text.length < 300) {
          for (const kw of rejectKeywords) {
            if (text.includes(kw)) {
              return text.trim().substring(0, 200);
            }
          }
        }
      }

      return null;
    });

    if (rejection) {
      console.error(`[jimeng] Content review rejection detected: ${rejection}`);
      throw new ContentReviewError(rejection);
    }
  }

  /**
   * Wait for video URL after generation is submitted.
   */
  private async waitForVideoUrl(
    page: Page,
    timeoutMs: number
  ): Promise<string> {
    let capturedVideoUrl: string | null = null;

    const responseHandler = (response: { url: () => string; headers: () => Record<string, string> }) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";
      if (
        (url.includes(".mp4") || contentType.includes("video/mp4")) &&
        url.startsWith("http") &&
        !URL_BLACKLIST.some((pattern) => url.includes(pattern))
      ) {
        console.log(`[jimeng] Captured video URL from network: ${url.substring(0, 100)}...`);
        capturedVideoUrl = url;
      }
    };
    page.on("response", responseHandler);

    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        await page.waitForTimeout(5000);

        // Check network-captured URL
        if (capturedVideoUrl) return capturedVideoUrl;

        // Check for video elements in DOM (exclude loading animations)
        const videoUrl = await page.evaluate((blacklist: string[]) => {
          const videos = document.querySelectorAll("video");
          for (let i = 0; i < videos.length; i++) {
            const src = videos[i].src || videos[i].querySelector("source")?.src;
            if (src && src.startsWith("http") && !blacklist.some((p) => src.includes(p))) {
              return src;
            }
          }
          const links = document.querySelectorAll('a[href*=".mp4"], a[download]');
          for (let i = 0; i < links.length; i++) {
            const href = (links[i] as HTMLAnchorElement).href;
            if (href && href.startsWith("http") && !blacklist.some((p) => href.includes(p))) {
              return href;
            }
          }
          return null;
        }, URL_BLACKLIST);

        if (videoUrl) {
          console.log("[jimeng] Found video URL in DOM");
          return videoUrl;
        }

        // Check for content review rejection during generation
        await this.checkContentReview(page);

        // Log page status for debugging
        const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000);
        console.log(`[jimeng] Still waiting... (${elapsed}s elapsed)`);
      }
      throw new Error(`等待视频生成超时（${timeoutMs / 1000}秒）`);
    } finally {
      page.off("response", responseHandler);
    }
  }

  async close() {
    await this.context?.close();
  }
}
