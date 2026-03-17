import "dotenv/config";
import { Worker, Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { JimengAutomation } from "./jimeng";
import { chromium } from "playwright";
import path from "path";
import { URL } from "url";

const db = new PrismaClient();
const jimeng = new JimengAutomation();

const WORKER_ID = `worker-${process.pid}`;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "3");
const SESSION_DIR = path.join(__dirname, "../.jimeng-session");

// Parse REDIS_URL into BullMQ connection options to avoid ioredis version conflicts
function parseRedisConnection(redisUrl: string) {
  try {
    const u = new URL(redisUrl);
    return {
      host: u.hostname || "localhost",
      port: u.port ? parseInt(u.port) : 6379,
      password: u.password || undefined,
      db: u.pathname && u.pathname.length > 1 ? parseInt(u.pathname.slice(1)) : 0,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

const redisConnection = parseRedisConnection(
  process.env.REDIS_URL || "redis://localhost:6379"
);

// First-login mode: open browser for manual login, then exit
async function firstLogin() {
  console.log("[first-login] Opening 即梦 for manual login. Log in, then press Ctrl+C.");
  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto("https://jimeng.jianying.com");
  // Keep open until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log("\n[first-login] Session saved. Run normally next time.");
      resolve();
    });
  });
  await browser.close();
}

async function main() {
  if (process.env.FIRST_LOGIN === "true") {
    return firstLogin();
  }

  await jimeng.init();
  console.log(`[${WORKER_ID}] Playwright Worker started, concurrency=${CONCURRENCY}`);

  const worker = new Worker(
    "video-generation",
    async (job: Job) => {
      const { jobId, content, duration, ratio } = job.data as {
        jobId: string;
        content: string;
        duration: number;
        ratio: string;
      };

      await db.videoJob.update({
        where: { id: jobId },
        data: { status: "PROCESSING", workerId: WORKER_ID, startedAt: new Date() },
      });

      try {
        const resultUrl = await jimeng.generateVideo({ content, duration, ratio });

        await db.videoJob.update({
          where: { id: jobId },
          data: {
            status: resultUrl ? "COMPLETED" : "FAILED",
            resultUrl,
            errorMessage: resultUrl ? null : "Video URL not captured",
            completedAt: new Date(),
          },
        });
      } catch (err) {
        const message = (err as Error).message;
        const jobRecord = await db.videoJob.findUnique({ where: { id: jobId } });
        const isLastRetry =
          (jobRecord?.retryCount ?? 0) + 1 >= (jobRecord?.maxRetries ?? 3);

        await db.videoJob.update({
          where: { id: jobId },
          data: {
            status: isLastRetry ? "FAILED" : "QUEUED",
            retryCount: { increment: 1 },
            errorMessage: message,
          },
        });
        throw err; // Let BullMQ handle retry
      }
    },
    { connection: redisConnection, concurrency: CONCURRENCY }
  );

  worker.on("failed", (job, err) => {
    console.error(`[${WORKER_ID}] Job ${job?.id} failed:`, err.message);
  });

  process.on("SIGTERM", async () => {
    await worker.close();
    await jimeng.close();
    await db.$disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
