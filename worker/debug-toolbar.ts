/**
 * Debug script: Stop the worker first, then run this.
 * It launches the browser with the same session, navigates to the video page,
 * and dumps the toolbar DOM structure.
 */
import { chromium } from "playwright";
import path from "path";

const SESSION_DIR = path.join(__dirname, "../.jimeng-session");
const JIMENG_URL = "https://jimeng.jianying.com/ai-tool/video/generate";

async function main() {
  console.log("[debug] Launching browser with worker session...");
  console.log("[debug] Make sure the Worker is STOPPED first!\n");

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  console.log("[debug] Navigating to video generate page...");
  await page.goto(JIMENG_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  const url = page.url();
  console.log(`[debug] Current URL: ${url}`);

  if (!url.includes("video/generate")) {
    console.log("[debug] Not on video generate page. May need login or redirect.");
    await page.screenshot({ path: "/tmp/jimeng-debug.png" });
    console.log("[debug] Screenshot at /tmp/jimeng-debug.png");
    await context.close();
    return;
  }

  await page.screenshot({ path: "/tmp/jimeng-toolbar.png" });
  console.log("[debug] Screenshot saved to /tmp/jimeng-toolbar.png");

  // === ANALYZE TOOLBAR ===
  console.log("\n========== TOOLBAR ANALYSIS ==========\n");

  const analysis = await page.evaluate(() => {
    const results: string[] = [];
    const allEls = document.querySelectorAll("*");

    // 1. Bottom bar elements
    results.push("=== BOTTOM BAR (y > 700) ===");
    allEls.forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.top > 700 && rect.height > 5 && rect.height < 80 && rect.width > 15) {
        const text = (el as HTMLElement).innerText?.trim().replace(/\n/g, " ").substring(0, 100);
        if (text && text.length > 0 && text.length < 80) {
          results.push(`  ${el.tagName} text="${text}" class="${(el.className || "").toString().substring(0, 120)}" rect=[${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}]`);
        }
      }
    });

    // 2. Ratio text
    results.push("\n=== RATIO TEXT ===");
    allEls.forEach((el) => {
      const text = el.textContent?.trim();
      if (text && /^(21:9|16:9|4:3|1:1|3:4|9:16)$/.test(text) && el.children.length === 0) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const p = el.parentElement;
        const pp = p?.parentElement;
        results.push(`  ${el.tagName} "${text}" class="${el.className}" parent="${p?.tagName}.${(p?.className||"").toString().substring(0,60)}" gparent="${pp?.tagName}.${(pp?.className||"").toString().substring(0,60)}" pos=[${Math.round(rect.left)},${Math.round(rect.top)}] vis=${rect.width > 0}`);
      }
    });

    // 3. Duration text
    results.push("\n=== DURATION TEXT ===");
    allEls.forEach((el) => {
      const text = el.textContent?.trim();
      if (text && /^\d+s$/.test(text) && el.children.length === 0) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const p = el.parentElement;
        const pp = p?.parentElement;
        results.push(`  ${el.tagName} "${text}" class="${el.className}" parent="${p?.tagName}.${(p?.className||"").toString().substring(0,80)}" gp="${pp?.tagName}.${(pp?.className||"").toString().substring(0,60)}" pos=[${Math.round(rect.left)},${Math.round(rect.top)}] vis=${rect.width > 0}`);
      }
    });

    // 4. Resolution text
    results.push("\n=== RESOLUTION TEXT ===");
    allEls.forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim();
      if (text && /\d+P/.test(text) && text.length < 20 && el.children.length <= 2) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        results.push(`  ${el.tagName} "${text}" class="${(el.className||"").toString().substring(0,100)}" pos=[${Math.round(rect.left)},${Math.round(rect.top)}] vis=${rect.width > 0}`);
      }
    });

    // 5. Toolbar hierarchy
    results.push("\n=== TOOLBAR CONTAINERS (wide, bottom) ===");
    document.querySelectorAll("div, footer, nav, section").forEach((c) => {
      const r = (c as HTMLElement).getBoundingClientRect();
      if (r.top > 750 && r.width > 500 && r.height > 20 && r.height < 80) {
        results.push(`\nCONTAINER: ${c.tagName} class="${(c.className||"").toString().substring(0,150)}" rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`);
        Array.from(c.children).forEach((child) => {
          const cr = (child as HTMLElement).getBoundingClientRect();
          if (cr.width > 0) {
            const t = (child as HTMLElement).innerText?.trim().replace(/\n/g," ").substring(0,60);
            results.push(`  ${child.tagName} text="${t}" class="${(child.className||"").toString().substring(0,100)}" rect=[${Math.round(cr.left)},${Math.round(cr.top)},${Math.round(cr.width)}x${Math.round(cr.height)}]`);
            // Second level
            Array.from(child.children).forEach((gc) => {
              const gr = (gc as HTMLElement).getBoundingClientRect();
              if (gr.width > 0) {
                const gt = (gc as HTMLElement).innerText?.trim().replace(/\n/g," ").substring(0,60);
                results.push(`    ${gc.tagName} text="${gt}" class="${(gc.className||"").toString().substring(0,100)}" rect=[${Math.round(gr.left)},${Math.round(gr.top)},${Math.round(gr.width)}x${Math.round(gr.height)}]`);
              }
            });
          }
        });
      }
    });

    return results.join("\n");
  });

  console.log(analysis);

  // === NOW CLICK THE RATIO BUTTON AND ANALYZE POPUP ===
  console.log("\n========== CLICK RATIO/RESOLUTION AREA ==========\n");

  // Click on the element that shows current ratio (e.g. "16:9 | 720P")
  const clickResult = await page.evaluate(() => {
    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const text = (el as HTMLElement).innerText?.trim();
      if (rect.top > 700 && text && /\d+:\d+/.test(text) && /\d+P/.test(text) && rect.width < 200) {
        (el as HTMLElement).click();
        return { clicked: true, text, tag: el.tagName, class: (el.className || "").toString().substring(0, 80) };
      }
    }
    return { clicked: false };
  });
  console.log("Click result:", clickResult);
  await page.waitForTimeout(1500);

  // Analyze what popped up
  const popupAnalysis = await page.evaluate(() => {
    const results: string[] = [];

    // Look for any popup/popover/dropdown that's now visible
    const allEls = document.querySelectorAll("*");
    const popupLike: Element[] = [];

    allEls.forEach((el) => {
      const cls = (el.className || "").toString();
      const role = el.getAttribute("role") || "";
      if (cls.match(/popup|popover|dropdown|overlay|float|panel|Popup|Popover|Dropdown|Menu/i) ||
          role === "listbox" || role === "dialog" || role === "menu") {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          popupLike.push(el);
        }
      }
    });

    results.push(`Found ${popupLike.length} popup-like elements`);
    popupLike.forEach((el, i) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      results.push(`\n[popup ${i}] ${el.tagName} class="${(el.className||"").toString().substring(0,120)}" size=${Math.round(rect.width)}x${Math.round(rect.height)} pos=[${Math.round(rect.left)},${Math.round(rect.top)}]`);
      // Dump children
      Array.from(el.querySelectorAll("*")).forEach((child) => {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) {
          const t = child.textContent?.trim();
          if (t && t.length < 30 && t.length > 0 && child.children.length <= 1) {
            results.push(`  ${child.tagName} text="${t}" class="${(child.className||"").toString().substring(0,80)}" pos=[${Math.round(cr.left)},${Math.round(cr.top)},${Math.round(cr.width)}x${Math.round(cr.height)}]`);
          }
        }
      });
    });

    // Also check for any new elements that contain ratio options
    results.push("\n\n=== VISIBLE RATIO OPTIONS AFTER CLICK ===");
    allEls.forEach((el) => {
      const text = el.textContent?.trim();
      if (text && /^(21:9|16:9|4:3|1:1|3:4|9:16|720P|1080P|选择比例|选择分辨率)$/.test(text) && el.children.length <= 1) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push(`  ${el.tagName} text="${text}" class="${(el.className||"").toString().substring(0,80)}" pos=[${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}]`);
        }
      }
    });

    return results.join("\n");
  });

  console.log(popupAnalysis);

  // Take screenshot of popup
  await page.screenshot({ path: "/tmp/jimeng-popup.png" });
  console.log("\n[debug] Popup screenshot saved to /tmp/jimeng-popup.png");

  // Close popup
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // === CLICK DURATION BUTTON ===
  console.log("\n========== CLICK DURATION AREA ==========\n");

  const durClick = await page.evaluate(() => {
    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const text = (el as HTMLElement).innerText?.trim();
      if (rect.top > 700 && text && /^\d+s$/.test(text) && rect.width < 100) {
        (el as HTMLElement).click();
        return { clicked: true, text, tag: el.tagName, class: (el.className || "").toString().substring(0, 80) };
      }
    }
    return { clicked: false };
  });
  console.log("Duration click result:", durClick);
  await page.waitForTimeout(1500);

  const durPopup = await page.evaluate(() => {
    const results: string[] = [];
    const allEls = document.querySelectorAll("*");

    // Look for duration options (5s, 10s, 15s)
    results.push("=== VISIBLE DURATION OPTIONS ===");
    allEls.forEach((el) => {
      const text = el.textContent?.trim();
      if (text && /^(5|10|15|5s|10s|15s|选择时长)$/.test(text) && el.children.length <= 1) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push(`  ${el.tagName} text="${text}" class="${(el.className||"").toString().substring(0,80)}" pos=[${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}]`);
        }
      }
    });

    return results.join("\n");
  });

  console.log(durPopup);
  await page.screenshot({ path: "/tmp/jimeng-dur-popup.png" });
  console.log("[debug] Duration popup screenshot saved to /tmp/jimeng-dur-popup.png");

  console.log("\n[debug] Done! Closing browser.");
  await context.close();
}

main().catch(console.error);
