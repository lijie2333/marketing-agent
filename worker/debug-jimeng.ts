import { chromium } from "playwright";
import path from "path";

const SESSION_DIR = path.resolve(__dirname, "../.jimeng-session");
const JIMENG_URL = "https://jimeng.jianying.com/ai-tool/video/generate";

async function main() {
  console.log("[debug] Launching browser...");
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  console.log(`[debug] Navigating to ${JIMENG_URL}`);
  await page.goto(JIMENG_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("[debug] Page loaded (domcontentloaded), waiting 8s for React hydration...");
  await page.waitForTimeout(8000);

  // 1. 分析所有可能的输入框
  console.log("\n=== 输入框分析 ===");
  const textareas = await page.locator("textarea").all();
  console.log(`textarea 数量: ${textareas.length}`);
  for (let i = 0; i < textareas.length; i++) {
    const ta = textareas[i];
    const placeholder = await ta.getAttribute("placeholder").catch(() => "");
    const box = await ta.boundingBox();
    console.log(`  textarea[${i}]: placeholder="${placeholder}", box=${JSON.stringify(box)}`);
  }

  const editables = await page.locator('[contenteditable="true"]').all();
  console.log(`contenteditable 数量: ${editables.length}`);
  for (let i = 0; i < editables.length; i++) {
    const el = editables[i];
    const box = await el.boundingBox();
    const tag = await el.evaluate((e: Element) => e.tagName);
    const cls = await el.getAttribute("class").catch(() => "");
    console.log(`  editable[${i}]: tag=${tag}, class="${cls?.substring(0, 80)}", box=${JSON.stringify(box)}`);
  }

  // 2. 分析所有按钮
  console.log("\n=== 按钮分析 ===");
  const buttons = await page.locator("button").all();
  console.log(`button 数量: ${buttons.length}`);
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const text = await btn.textContent().catch(() => "");
    const box = await btn.boundingBox();
    const disabled = await btn.isDisabled().catch(() => false);
    const cls = await btn.getAttribute("class").catch(() => "");
    if (text && text.trim()) {
      console.log(`  button[${i}]: text="${text.trim().substring(0, 50)}", disabled=${disabled}, box=${JSON.stringify(box)}, class="${cls?.substring(0, 60)}"`);
    }
  }

  // 3. 搜索含"生成"文本的所有元素
  console.log("\n=== 含'生成'文本的元素 ===");
  const genElements = await page.locator(':text("生成")').all();
  console.log(`含"生成"的元素数量: ${genElements.length}`);
  for (let i = 0; i < genElements.length; i++) {
    const el = genElements[i];
    const tag = await el.evaluate((e: Element) => e.tagName);
    const text = await el.textContent().catch(() => "");
    const box = await el.boundingBox();
    const cls = await el.getAttribute("class").catch(() => "");
    console.log(`  [${i}]: tag=${tag}, text="${text?.trim().substring(0, 50)}", box=${JSON.stringify(box)}, class="${cls?.substring(0, 60)}"`);
  }

  // 4. 搜索所有role=button的元素
  console.log("\n=== role=button 元素 ===");
  const roleButtons = await page.locator('[role="button"]').all();
  for (let i = 0; i < roleButtons.length; i++) {
    const el = roleButtons[i];
    const text = await el.textContent().catch(() => "");
    if (text && text.trim()) {
      const box = await el.boundingBox();
      const cls = await el.getAttribute("class").catch(() => "");
      console.log(`  role-btn[${i}]: text="${text.trim().substring(0, 50)}", box=${JSON.stringify(box)}, class="${cls?.substring(0, 60)}"`);
    }
  }

  // 5. 检查页面上所有可点击的、看起来像提交按钮的元素
  console.log("\n=== 可能的提交区域（含 class 中 generate/submit/send 的元素）===");
  const submitLike = await page.locator('[class*="generate"], [class*="submit"], [class*="send"], [class*="create"], [class*="btn-primary"]').all();
  for (let i = 0; i < submitLike.length; i++) {
    const el = submitLike[i];
    const tag = await el.evaluate((e: Element) => e.tagName);
    const text = await el.textContent().catch(() => "");
    const cls = await el.getAttribute("class").catch(() => "");
    const box = await el.boundingBox();
    console.log(`  submit-like[${i}]: tag=${tag}, text="${text?.trim().substring(0, 50)}", class="${cls?.substring(0, 80)}", box=${JSON.stringify(box)}`);
  }

  console.log("\n[debug] 分析完毕，浏览器保持打开。按 Ctrl+C 退出。");
  await new Promise<void>(() => {});
}

main().catch(console.error);
