/**
 * Direct test: launch browser, navigate to 即梦, configure params.
 * No queue, no database - just test the browser automation.
 */
import { JimengAutomation } from "./jimeng";

async function main() {
  const jimeng = new JimengAutomation();
  await jimeng.init();
  console.log("[test] Browser launched. Starting generateVideo...");

  try {
    const url = await jimeng.generateVideo({
      content: "一位年轻女性走在樱花大道上，春风拂面，花瓣飘落。镜头缓缓跟随，暖色调，自然光。",
      duration: 15,
      ratio: "9:16",
    });
    console.log("[test] Video URL:", url);
  } catch (err) {
    console.error("[test] Error:", err);
  }

  // Keep browser open for inspection
  console.log("[test] Browser stays open. Press Ctrl+C to exit.");
  await new Promise(() => {});
}

main().catch(console.error);
