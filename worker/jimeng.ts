import { BrowserContext, Page, chromium } from "playwright";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const JIMENG_URL = "https://jimeng.jianying.com/ai-tool/video/generate";
const SESSION_DIR = path.join(__dirname, "../.jimeng-session");
const DEFAULT_MODEL = "Seedance 2.0 Fast";
const DEFAULT_REFERENCE_MODE = "全能参考";
const VIDEO_GENERATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

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

      // Step 3: Find and fill input using the same style of heuristics as the helper tool
      console.log("[jimeng] Filling prompt text...");
      const inputTarget = await this.findPromptInput(page);
      const escapedContent = JSON.stringify(params.content);
      const fillResult = await page.evaluate(`(function() {
        var text = ${escapedContent};
        var target = ${JSON.stringify(inputTarget)};
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
        function matchTarget(el) {
          if (!target) return true;
          var text = (el.innerText || el.textContent || "").trim();
          var placeholder = "";
          try { placeholder = el.getAttribute("placeholder") || ""; } catch(e) {}
          return (
            (target.tagName && el.tagName === target.tagName) ||
            (target.placeholder && placeholder.indexOf(target.placeholder) > -1) ||
            (target.text && text.indexOf(target.text) > -1)
          );
        }
        var textareas = document.querySelectorAll("textarea");
        for (var i = 0; i < textareas.length; i++) {
          var ta = textareas[i];
          if (ta.offsetWidth > 100 && ta.offsetHeight > 30 && matchTarget(ta)) { fillIt(ta, text); return { success: true, type: "textarea" }; }
        }
        var textInputs = document.querySelectorAll('input[type="text"]');
        for (var k = 0; k < textInputs.length; k++) {
          var inp = textInputs[k];
          if (inp.offsetWidth > 100 && inp.offsetHeight > 30 && matchTarget(inp)) { fillIt(inp, text); return { success: true, type: "input" }; }
        }
        var editables = document.querySelectorAll('[contenteditable="true"]');
        for (var j = 0; j < editables.length; j++) {
          var el = editables[j];
          if (el.offsetWidth > 100 && el.offsetHeight > 20 && matchTarget(el)) { fillIt(el, text); return { success: true, type: "contenteditable" }; }
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
      const submitTarget = await this.findSubmitButton(page);

      // Try 1: Primary icon-only button (即梦的圆形提交按钮)
      const iconBtn = submitTarget?.kind === "primary-icon"
        ? page.locator("button.lv-btn-primary.lv-btn-icon-only").first()
        : page.locator("button.lv-btn-primary.lv-btn-icon-only").first();
      if (await iconBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        if (!(await iconBtn.isDisabled().catch(() => true))) {
          console.log("[jimeng] Clicking primary icon button...");
          await iconBtn.click();
          clicked = true;
        }
      }

      // Try 2: Any primary button
      if (!clicked) {
        const primaryBtn = submitTarget?.text
          ? page.getByText(submitTarget.text, { exact: false }).first()
          : page.locator("button.lv-btn-primary").first();
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
        const genBtn = submitTarget?.text
          ? page.getByText(submitTarget.text, { exact: false }).first()
          : page.locator('button:has-text("生成")').first();
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

      // Step 6: Wait for video generation (up to 2 hours)
      console.log("[jimeng] Waiting for video generation (up to 2 hours)...");
      const videoUrl = await this.waitForVideoUrl(page, VIDEO_GENERATION_TIMEOUT_MS);
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
    const preparedPaths = this.prepareReferenceImagePaths(filePaths);
    const uploadSignals = {
      sawUploadToken: false,
      sawApplyUpload: false,
      sawCommitUpload: false,
      sawSubmitAudit: false,
    };
    const requestListener = (request: { url: () => string }) => {
      const url = request.url();
      if (url.includes("get_upload_token")) uploadSignals.sawUploadToken = true;
      if (url.includes("ApplyImageUpload")) uploadSignals.sawApplyUpload = true;
      if (url.includes("CommitImageUpload")) uploadSignals.sawCommitUpload = true;
      if (url.includes("submit_audit_job")) uploadSignals.sawSubmitAudit = true;
    };
    page.on("request", requestListener as never);

    try {
      // Strategy 1: Write directly into the dedicated "参考内容" input after pre-processing.
      const referenceInput = page.locator('.reference-group-content-ztz9q2 input[type="file"]').first();
      if (await referenceInput.count()) {
        try {
          await referenceInput.setInputFiles(preparedPaths);
          await referenceInput.evaluate((el) => {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          });
          if (await this.waitForReferenceUploadSuccess(page, uploadSignals)) {
            console.log("[jimeng] Reference images uploaded via dedicated reference input");
            return;
          }
          console.warn("[jimeng] Dedicated reference input did not produce a verified uploaded state");
        } catch (err) {
          console.warn("[jimeng] Dedicated reference input upload failed, trying visible trigger:", err);
        }
      }

      // Strategy 2: Click the visible "参考内容" area so the file lands in the correct slot.
      const uploadButtonLocators = [
        page.getByText("参考内容", { exact: false }).first(),
        page.getByText("全能参考", { exact: false }).first(),
        page.getByText("上传", { exact: false }).first(),
        page.getByText("图片", { exact: false }).first(),
        page.getByText("参考", { exact: false }).first(),
        page.locator('button[aria-label*="上传"]').first(),
        page.locator('button[aria-label*="图片"]').first(),
        page.locator('button[aria-label*="参考"]').first(),
        page.locator('[class*="upload"] button').first(),
        page.locator('[class*="reference"] button').first(),
        page.locator('[class*="attach"] button').first(),
      ];

      for (const btn of uploadButtonLocators) {
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          try {
            const [fileChooser] = await Promise.all([
              page.waitForEvent("filechooser", { timeout: 5000 }),
              btn.click(),
            ]);
            await fileChooser.setFiles(preparedPaths);
            if (await this.waitForReferenceUploadSuccess(page, uploadSignals)) {
              console.log("[jimeng] Reference images uploaded via visible upload trigger");
              return;
            }
          } catch {
            continue;
          }
        }
      }

      // Strategy 3: Find a file input only after the visible trigger failed.
      const fileInputInfo = await page.evaluate(`(function() {
        var inputs = document.querySelectorAll('input[type="file"]');
        for (var i = 0; i < inputs.length; i++) {
          var inp = inputs[i];
          var accept = inp.accept || "";
          var parentText = ((inp.parentElement && inp.parentElement.innerText) || "") + " " +
            ((inp.parentElement && inp.parentElement.parentElement && inp.parentElement.parentElement.innerText) || "");
          if (parentText.indexOf("参考内容") === -1) continue;
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
          await targetInput.setInputFiles(preparedPaths);
          await targetInput.evaluate((el) => {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          });
          if (await this.waitForReferenceUploadSuccess(page, uploadSignals)) {
            console.log("[jimeng] Reference images set via file input fallback");
            return;
          }
        } catch (err) {
          console.warn("[jimeng] Direct setInputFiles fallback failed, trying hidden input:", err);
        }
      }

      // Strategy 4: Trigger hidden file input via JS click
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 3000 }),
          page.evaluate(`(function() {
            var inputs = document.querySelectorAll('input[type="file"]');
            for (var i = 0; i < inputs.length; i++) {
              var inp = inputs[i];
              var parentText = ((inp.parentElement && inp.parentElement.innerText) || "") + " " +
                ((inp.parentElement && inp.parentElement.parentElement && inp.parentElement.parentElement.innerText) || "");
              if (parentText.indexOf("参考内容") > -1) { inp.click(); return true; }
            }
            return false;
          })()`),
        ]);
        await fileChooser.setFiles(preparedPaths);
        if (await this.waitForReferenceUploadSuccess(page, uploadSignals)) {
          console.log("[jimeng] Reference images uploaded via hidden input trigger");
          return;
        }
      } catch {
        console.warn("[jimeng] Could not upload reference images — no upload trigger found.");
      }
    } finally {
      page.off("request", requestListener as never);
    }

    throw new Error("参考图片上传失败：即梦未显示已上传状态");
  }

  private prepareReferenceImagePaths(filePaths: string[]): string[] {
    return filePaths.map((filePath) => this.prepareReferenceImagePath(filePath));
  }

  private prepareReferenceImagePath(filePath: string): string {
    if (process.platform !== "darwin") {
      return filePath;
    }

    const dimensions = this.readImageDimensions(filePath);
    if (!dimensions) {
      return filePath;
    }

    if (dimensions.width >= 512 && dimensions.height >= 512) {
      return filePath;
    }

    const tmpDir = path.join(os.tmpdir(), "marketing-agent-reference");
    fs.mkdirSync(tmpDir, { recursive: true });

    const parsed = path.parse(filePath);
    const safeBase = parsed.name.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const scaledPath = path.join(tmpDir, `${safeBase}-scaled.jpg`);
    const paddedPath = path.join(tmpDir, `${safeBase}-padded.png`);

    try {
      execFileSync("sips", ["-Z", "1024", filePath, "--out", scaledPath], { stdio: "ignore" });
      execFileSync("sips", ["-p", "1024", "1024", "--padColor", "FFFFFF", scaledPath, "--out", paddedPath], {
        stdio: "ignore",
      });
      console.log(
        `[jimeng] Upscaled small reference asset ${path.basename(filePath)} (${dimensions.width}x${dimensions.height}) -> ${path.basename(paddedPath)}`
      );
      return paddedPath;
    } catch (error) {
      console.warn("[jimeng] Failed to upscale small reference asset, using original file instead:", error);
      return filePath;
    }
  }

  private readImageDimensions(filePath: string): { width: number; height: number } | null {
    try {
      const output = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], { encoding: "utf8" });
      const widthMatch = output.match(/pixelWidth:\\s*(\\d+)/);
      const heightMatch = output.match(/pixelHeight:\\s*(\\d+)/);
      if (!widthMatch || !heightMatch) {
        return null;
      }
      return {
        width: Number(widthMatch[1]),
        height: Number(heightMatch[1]),
      };
    } catch {
      return null;
    }
  }

  private async waitForReferenceUploadSuccess(
    page: Page,
    uploadSignals: {
      sawUploadToken: boolean;
      sawApplyUpload: boolean;
      sawCommitUpload: boolean;
      sawSubmitAudit: boolean;
    },
    timeoutMs = 12000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await page.evaluate(`(function() {
        var zone = document.querySelector('.reference-group-content-ztz9q2');
        var text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim();
        var input = zone ? zone.querySelector('input[type="file"]') : null;
        return {
          fileCount: input && input.files ? input.files.length : 0,
          hasUploadedHint: text.indexOf('使用 快速调用参考内容') > -1,
          hasImageRef: text.indexOf('@图片1') > -1 || text.indexOf('图片1') > -1,
          hasTooSmallToast: text.indexOf('素材尺寸过小') > -1,
          hasMiniReferenceCard: !!document.querySelector('.reference-upload-h7tmnr.mini-XAjjpa'),
        };
      })()`) as {
        hasUploadedHint: boolean;
        hasImageRef: boolean;
        hasTooSmallToast: boolean;
        hasMiniReferenceCard: boolean;
      };

      const sawUploadPipeline =
        uploadSignals.sawUploadToken &&
        uploadSignals.sawApplyUpload &&
        uploadSignals.sawCommitUpload &&
        uploadSignals.sawSubmitAudit;

      if (state.hasUploadedHint || state.hasImageRef || state.hasMiniReferenceCard || sawUploadPipeline) {
        return true;
      }

      if (state.hasTooSmallToast) {
        return false;
      }

      await page.waitForTimeout(500);
    }

    return false;
  }

  /**
   * Verify video parameters in the bottom toolbar.
   * Default should be: 视频生成, Seedance 2.0 Fast, 全能参考, 9:16, 15s.
   */
  private async configureVideoParams(
    page: Page,
    params: { duration: number; ratio: string }
  ): Promise<void> {
    await this.ensureToolbarPreset(page);

    // Read current toolbar state
    const toolbarInfo = await page.evaluate(`(function() {
      var els = document.querySelectorAll("*");
      var ratio = "";
      var duration = "";
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var rect = el.getBoundingClientRect();
        var text = el.innerText ? el.innerText.trim() : "";
        if (rect.top > window.innerHeight - 260 && rect.width < 180 && rect.height < 56) {
          var ratioMatch = text.match(/(21:9|16:9|4:3|1:1|3:4|9:16)/);
          var durMatch = text.match(/(5s|10s|15s)/);
          if (ratioMatch) ratio = ratioMatch[1];
          if (durMatch) duration = durMatch[1];
        }
      }
      return { ratio: ratio, duration: duration };
    })()`) as { ratio: string; duration: string };

    console.log(`[jimeng] Current toolbar: ratio=${toolbarInfo.ratio}, duration=${toolbarInfo.duration}`);

    const targetRatio = params.ratio || "9:16";
    const targetDur = (params.duration || 15) + "s";
    await this.ensureToolbarSlot(page, 4, targetDur, [targetDur]);

    if (toolbarInfo.ratio === targetRatio && toolbarInfo.duration === targetDur) {
      console.log("[jimeng] Parameters already correct, skipping configuration");
      return;
    }

    // --- Fix ratio if needed ---
    if (toolbarInfo.ratio && toolbarInfo.ratio !== targetRatio) {
      console.log(`[jimeng] Ratio mismatch: ${toolbarInfo.ratio} -> ${targetRatio}`);
      const ratioBtnPos = await page.evaluate(`(function() {
        var currentRatio = ${JSON.stringify(toolbarInfo.ratio)};
        var els = document.querySelectorAll("*");
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          var rect = el.getBoundingClientRect();
          var text = el.innerText ? el.innerText.trim() : "";
          if (rect.top > window.innerHeight - 260 && text.indexOf(currentRatio) > -1 && rect.width < 180) {
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
        }
        return null;
      })()`) as { x: number; y: number } | null;

      if (ratioBtnPos) {
        await page.mouse.click(ratioBtnPos.x, ratioBtnPos.y);
        await page.waitForTimeout(800);

        const ratioOpt = await page.evaluate(`(function() {
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
      const durBtnPos = await page.evaluate(`(function() {
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

        const durOpt = await page.evaluate(`(function() {
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

  private async ensureToolbarPreset(page: Page): Promise<void> {
    const slots = await this.readToolbarSlots(page);
    if (slots.length > 0) {
      console.log(
        `[jimeng] Toolbar slots: ${slots.map((slot, index) => `[${index}] ${slot.text || "(empty)"}`).join(" | ")}`
      );
    }

    await this.ensureToolbarSlot(page, 1, DEFAULT_MODEL, [DEFAULT_MODEL, "Seedance 2.0"]);
    await this.ensureToolbarSlot(page, 2, DEFAULT_REFERENCE_MODE, [DEFAULT_REFERENCE_MODE]);
  }

  private async findPromptInput(
    page: Page
  ): Promise<{ tagName?: string; placeholder?: string; text?: string } | null> {
    return await page.evaluate(`(function() {
      var candidates = document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el.offsetWidth <= 100 || el.offsetHeight <= 20) continue;
        var placeholder = (el.getAttribute("placeholder") || "").trim();
        var text = (el.textContent || "").trim();
        var lower = placeholder.toLowerCase();
        if (
          el.tagName === "TEXTAREA" ||
          lower.indexOf("描述") > -1 ||
          lower.indexOf("输入") > -1 ||
          lower.indexOf("prompt") > -1 ||
          lower.indexOf("想") > -1
        ) {
          return {
            tagName: el.tagName,
            placeholder: placeholder || undefined,
            text: text ? text.substring(0, 30) : undefined
          };
        }
      }
      return null;
    })()`) as { tagName?: string; placeholder?: string; text?: string } | null;
  }

  private async findSubmitButton(
    page: Page
  ): Promise<{ kind: "primary-icon" | "text"; text?: string } | null> {
    const primaryIconVisible = await page.locator("button.lv-btn-primary.lv-btn-icon-only").first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (primaryIconVisible) {
      return { kind: "primary-icon" };
    }

    return await page.evaluate(`(function() {
      var btns = document.querySelectorAll('button, [role="button"], a.btn, div[class*="btn"], div[class*="submit"], div[class*="generate"]');
      for (var i = 0; i < btns.length; i++) {
        var el = btns[i];
        var text = (el.textContent || "").trim();
        if (!text) continue;
        if (text === "生成" || text.indexOf("生成") > -1 || text === "Generate") {
          return { kind: "text", text: text.substring(0, 20) };
        }
      }
      return null;
    })()`) as { kind: "primary-icon" | "text"; text?: string } | null;
  }

  private async ensureToolbarSlot(
    page: Page,
    index: number,
    targetText: string,
    popupTexts: string[]
  ): Promise<void> {
    const slots = await this.readToolbarSlots(page);
    const slot = slots[index];

    if (!slot) {
      console.warn(`[jimeng] Toolbar slot ${index} not found, skipping preset "${targetText}"`);
      return;
    }

    if (slot.text.includes(targetText)) {
      console.log(`[jimeng] Toolbar slot ${index} already set to ${targetText}`);
      return;
    }

    console.log(`[jimeng] Toolbar slot ${index} mismatch: "${slot.text}" -> "${targetText}"`);
    await page.mouse.click(slot.x, slot.y);
    await page.waitForTimeout(700);

    const optionClicked = await this.clickVisibleOption(page, popupTexts);
    if (!optionClicked) {
      console.warn(`[jimeng] Could not find option "${targetText}" after opening toolbar slot ${index}`);
      await page.keyboard.press("Escape").catch(() => {});
      return;
    }

    console.log(`[jimeng] Selected preset "${targetText}"`);
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);

    const updatedSlots = await this.readToolbarSlots(page);
    const updated = updatedSlots[index];
    if (!updated?.text.includes(targetText)) {
      console.warn(
        `[jimeng] Toolbar slot ${index} did not persist target "${targetText}". Current="${updated?.text || "missing"}"`
      );
    }
  }

  private async readToolbarSlots(page: Page): Promise<Array<{ text: string; x: number; y: number }>> {
    return await page.evaluate(`(function() {
      var nodes = document.querySelectorAll(
        'div.lv-select.toolbar-select-h345g7, div.feature-select-VcsuXi, button.toolbar-button-FhFnQ_'
      );
      var items = [];
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var rect = el.getBoundingClientRect();
        var text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
        if (!text) continue;
        if (/^\\d+$/.test(text)) continue;
        if (rect.width <= 50 || rect.width >= 320) continue;
        if (rect.height <= 24 || rect.height >= 72) continue;
        if (rect.top < window.innerHeight - 320) continue;
        items.push({
          text: text,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          left: rect.left
        });
      }
      var deduped = [];
      var seen = {};
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var key = [Math.round(item.left), Math.round(item.x), Math.round(item.y), item.text].join("|");
        if (seen[key]) continue;
        seen[key] = true;
        deduped.push(item);
      }
      deduped.sort(function(a, b) { return a.left - b.left; });
      return deduped;
    })()`) as Array<{ text: string; x: number; y: number }>;
  }

  private async clickVisibleOption(
    page: Page,
    targets: string[]
  ): Promise<boolean> {
    for (const target of targets) {
      const option = page.locator("li.lv-select-option").filter({ hasText: target }).first();
      if (await option.isVisible({ timeout: 800 }).catch(() => false)) {
        await option.click();
        return true;
      }
    }

    const fallbackPos = await page.evaluate(`(function() {
      var targets = ${JSON.stringify(targets)};
      var exactTargets = targets.map(function(item) { return item.trim(); });
      var nodes = document.querySelectorAll("*");
      var results = [];
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.top > window.innerHeight - 160) continue;
        var text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
        if (!text) continue;
        for (var j = 0; j < exactTargets.length; j++) {
          if (text === exactTargets[j] || text.indexOf(exactTargets[j]) > -1) {
            results.push({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              top: rect.top,
              width: rect.width,
            });
            break;
          }
        }
      }
      results.sort(function(a, b) {
        if (a.top !== b.top) return a.top - b.top;
        return a.width - b.width;
      });
      return results[0] || null;
    })()`) as { x: number; y: number } | null;

    if (!fallbackPos) {
      return false;
    }

    await page.mouse.click(fallbackPos.x, fallbackPos.y);
    return true;
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
