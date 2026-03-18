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
    referenceImagePaths?: string[];
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

      // Step 2: Upload reference images if provided (全能参考 / image-to-video)
      if (params.referenceImagePaths && params.referenceImagePaths.length > 0) {
        console.log(`[jimeng] Uploading ${params.referenceImagePaths.length} reference image(s)...`);
        await this.uploadReferenceImages(page, params.referenceImagePaths);
      }

      // Step 3: Find and fill input using React-compatible injection
      console.log("[jimeng] Filling prompt text...");
      const escapedContent = JSON.stringify(params.content);
      const fillResult = await page.evaluate(`(function() {
        var text = ${escapedContent};
        var fillIt = (function(el, t) {
          el.focus();
          if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") { el.select(); }
          else { try { document.execCommand("selectAll", false, undefined); } catch(e) {} }
          var ok = false;
          try { ok = document.execCommand("insertText", false, t); } catch(e) {}
          var cur = el.value !== undefined ? el.value : el.textContent;
          if (ok && cur && cur.indexOf(t) > -1) return true;
          if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
            var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            var desc = Object.getOwnPropertyDescriptor(proto, "value");
            if (desc && desc.set) { desc.set.call(el, t); el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); return true; }
          }
          el.textContent = t;
          el.dispatchEvent(new Event("input",{bubbles:true}));
          return true;
        });
        var textareas = document.querySelectorAll("textarea");
        for (var i = 0; i < textareas.length; i++) {
          var ta = textareas[i];
          if (ta.offsetWidth > 100 && ta.offsetHeight > 30) { fillIt(ta, text); return { success: true, type: "textarea" }; }
        }
        var editables = document.querySelectorAll('[contenteditable="true"]');
        for (var j = 0; j < editables.length; j++) {
          var el = editables[j];
          if (el.offsetWidth > 100 && el.offsetHeight > 20) { fillIt(el, text); return { success: true, type: "contenteditable" }; }
        }
        return { success: false, error: "未找到输入框" };
      })()`) as { success: boolean; type?: string; error?: string };

      console.log(`[jimeng] Fill result:`, fillResult);
      if (!fillResult.success) {
        throw new Error(fillResult.error || "未找到输入框");
      }

      await page.waitForTimeout(800);

      // Step 4: Click submit button using Playwright native click (safer, no parent propagation)
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

      // Step 5: Brief wait then check for immediate rejection (审核不通过)
      await page.waitForTimeout(3000);
      await this.checkContentReview(page);

      // Step 6: Wait for video generation (up to 5 minutes)
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
   * Upload reference images to 即梦 (全能参考 / image-to-video mode).
   * After upload, the platform labels them @图片1, @图片2, etc.
   * The prompt text should already contain @图片N references.
   */
  private async uploadReferenceImages(page: Page, filePaths: string[]): Promise<void> {
    // Strategy 1: Find a visible file input accepting images and use setInputFiles directly
    const fileInputInfo = await page.evaluate(`(function() {
      var inputs = document.querySelectorAll('input[type="file"]');
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var accept = inp.accept || "";
        if (accept.indexOf("image") > -1 || accept === "") {
          return { found: true, index: i };
        }
      }
      return { found: false };
    })()`) as { found: boolean; index?: number };

    if (fileInputInfo.found && fileInputInfo.index !== undefined) {
      const fileInputs = page.locator('input[type="file"]');
      const targetInput = fileInputs.nth(fileInputInfo.index);
      try {
        await targetInput.setInputFiles(filePaths);
        console.log("[jimeng] Reference images set via file input");
        await page.waitForTimeout(3000);
        return;
      } catch (err) {
        console.warn("[jimeng] Direct setInputFiles failed, trying upload button:", err);
      }
    }

    // Strategy 2: Click an upload/reference button to trigger file chooser
    const uploadButtonSelectors = [
      'button[aria-label*="上传"]',
      'button[aria-label*="图片"]',
      'button[aria-label*="参考"]',
      '[class*="upload"] button',
      '[class*="reference"] button',
      '[class*="attach"] button',
    ];

    for (const sel of uploadButtonSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        try {
          const [fileChooser] = await Promise.all([
            page.waitForEvent("filechooser", { timeout: 5000 }),
            btn.click(),
          ]);
          await fileChooser.setFiles(filePaths);
          console.log(`[jimeng] Reference images uploaded via button: ${sel}`);
          await page.waitForTimeout(3000);
          return;
        } catch {
          continue;
        }
      }
    }

    // Strategy 3: Trigger hidden file input via JS click
    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 3000 }),
        page.evaluate(`(function() {
          var inputs = document.querySelectorAll('input[type="file"]');
          if (inputs.length > 0) { inputs[0].click(); return true; }
          return false;
        })()`),
      ]);
      await fileChooser.setFiles(filePaths);
      console.log("[jimeng] Reference images uploaded via hidden input trigger");
      await page.waitForTimeout(3000);
    } catch {
      console.warn("[jimeng] Could not upload reference images — no upload trigger found. Proceeding without images.");
    }
  }

  /**
   * Verify video parameters in the bottom toolbar.
   * Default should be: Seedance 2.0 Fast, 9:16, 15s.
   * Only logs current state — the defaults are already correct.
   */
  private async configureVideoParams(
    page: Page,
    params: { duration: number; ratio: string }
  ): Promise<void> {
    // Read current toolbar state
    var toolbarInfo = await page.evaluate(`(function() {
      var els = document.querySelectorAll("*");
      var ratio = "";
      var duration = "";
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var rect = el.getBoundingClientRect();
        var text = el.innerText ? el.innerText.trim() : "";
        if (rect.top > 700 && rect.width < 80 && rect.height < 40) {
          if (/^\\d+:\\d+$/.test(text)) ratio = text;
          if (/^\\d+s$/.test(text)) duration = text;
        }
      }
      return { ratio: ratio, duration: duration };
    })()`) as { ratio: string; duration: string };

    console.log(`[jimeng] Current toolbar: ratio=${toolbarInfo.ratio}, duration=${toolbarInfo.duration}`);

    var targetRatio = params.ratio || "9:16";
    var targetDur = (params.duration || 15) + "s";

    if (toolbarInfo.ratio === targetRatio && toolbarInfo.duration === targetDur) {
      console.log("[jimeng] Parameters already correct, skipping configuration");
      return;
    }

    // --- Fix ratio if needed ---
    if (toolbarInfo.ratio && toolbarInfo.ratio !== targetRatio) {
      console.log(`[jimeng] Ratio mismatch: ${toolbarInfo.ratio} -> ${targetRatio}`);
      var ratioBtnPos = await page.evaluate(`(function() {
        var currentRatio = ${JSON.stringify(toolbarInfo.ratio)};
        var els = document.querySelectorAll("*");
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          var rect = el.getBoundingClientRect();
          var text = el.innerText ? el.innerText.trim() : "";
          if (rect.top > 700 && text === currentRatio && rect.width < 80) {
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
        }
        return null;
      })()`) as { x: number; y: number } | null;

      if (ratioBtnPos) {
        await page.mouse.click(ratioBtnPos.x, ratioBtnPos.y);
        await page.waitForTimeout(800);

        var ratioOpt = await page.evaluate(`(function() {
          var target = ${JSON.stringify(targetRatio)};
          var labels = document.querySelectorAll("label.lv-radio");
          for (var i = 0; i < labels.length; i++) {
            if (labels[i].textContent && labels[i].textContent.trim() === target) {
              var rect = labels[i].getBoundingClientRect();
              if (rect.width > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          return null;
        })()`) as { x: number; y: number } | null;

        if (ratioOpt) {
          await page.mouse.click(ratioOpt.x, ratioOpt.y);
          console.log(`[jimeng] Selected ratio: ${targetRatio}`);
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }

    // --- Fix duration if needed ---
    if (toolbarInfo.duration && toolbarInfo.duration !== targetDur) {
      console.log(`[jimeng] Duration mismatch: ${toolbarInfo.duration} -> ${targetDur}`);
      var durBtnPos = await page.evaluate(`(function() {
        var currentDur = ${JSON.stringify(toolbarInfo.duration)};
        var els = document.querySelectorAll("*");
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          var rect = el.getBoundingClientRect();
          var text = el.innerText ? el.innerText.trim() : "";
          if (rect.top > 700 && text === currentDur && rect.width < 80) {
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
        }
        return null;
      })()`) as { x: number; y: number } | null;

      if (durBtnPos) {
        await page.mouse.click(durBtnPos.x, durBtnPos.y);
        await page.waitForTimeout(800);

        var durOpt = await page.evaluate(`(function() {
          var target = ${JSON.stringify(targetDur)};
          var options = document.querySelectorAll("li.lv-select-option");
          for (var i = 0; i < options.length; i++) {
            var text = options[i].textContent ? options[i].textContent.trim() : "";
            if (text === target) {
              var rect = options[i].getBoundingClientRect();
              if (rect.width > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          return null;
        })()`) as { x: number; y: number } | null;

        if (durOpt) {
          await page.mouse.click(durOpt.x, durOpt.y);
          console.log(`[jimeng] Selected duration: ${targetDur}`);
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }
  }

  /**
   * Check if 即梦 rejected the prompt due to content review (审核不通过).
   * Scans for common rejection UI patterns on the page.
   */
  private async checkContentReview(page: Page): Promise<void> {
    const rejection = await page.evaluate(`(function() {
      var kw = ["审核不通过","内容违规","不合规","违反","敏感内容","无法生成","内容审核","生成失败","包含违禁","不支持生成","触发安全","安全审核","内容不合规"];
      var sels = [
        ".lv-message, .lv-notification, .lv-toast, [class*='toast'], [class*='message'], [class*='notice'], [class*='alert'], [role='alert']",
        ".lv-modal, [class*='modal'], [class*='dialog'], [role='dialog']",
        "[class*='error'], [class*='fail'], [class*='reject'], [class*='warning']"
      ];
      for (var s = 0; s < sels.length; s++) {
        var els = document.querySelectorAll(sels[s]);
        for (var i = 0; i < els.length; i++) {
          var text = els[i].innerText || "";
          if (s === 2 && (text.length <= 2 || text.length >= 300)) continue;
          for (var j = 0; j < kw.length; j++) {
            if (text.indexOf(kw[j]) > -1) return text.trim().substring(0, 200);
          }
        }
      }
      return null;
    })()`) as string | null;

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
        const videoUrl = await page.evaluate(`(function() {
          var bl = ${JSON.stringify(URL_BLACKLIST)};
          var videos = document.querySelectorAll("video");
          for (var i = 0; i < videos.length; i++) {
            var source = videos[i].querySelector("source");
            var src = videos[i].src || (source ? source.src : "");
            if (src && src.indexOf("http") === 0) {
              var blocked = false;
              for (var j = 0; j < bl.length; j++) { if (src.indexOf(bl[j]) > -1) { blocked = true; break; } }
              if (!blocked) return src;
            }
          }
          var links = document.querySelectorAll('a[href*=".mp4"], a[download]');
          for (var i = 0; i < links.length; i++) {
            var href = links[i].href;
            if (href && href.indexOf("http") === 0) {
              var blocked = false;
              for (var j = 0; j < bl.length; j++) { if (href.indexOf(bl[j]) > -1) { blocked = true; break; } }
              if (!blocked) return href;
            }
          }
          return null;
        })()`) as string | null;

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
