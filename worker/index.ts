import "dotenv/config";
import { Worker, Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { JimengAutomation, ContentReviewError } from "./jimeng";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { URL } from "url";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });
const jimeng = new JimengAutomation();

const WORKER_ID = `worker-${process.pid}`;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "3");
const VIDEOS_DIR = path.resolve(__dirname, "../uploads/videos");

// Ensure videos directory exists
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

/** Download a remote video to local disk, return the local filename */
async function downloadVideo(remoteUrl: string, jobId: string): Promise<string> {
  const filename = `${jobId}.mp4`;
  const filepath = path.join(VIDEOS_DIR, filename);
  console.log(`[download] Downloading ${remoteUrl.substring(0, 80)}... → ${filepath}`);

  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(`[download] Saved ${filename} (${sizeMB} MB)`);
  return filename;
}

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
  const browser = await chromium.launchPersistentContext(
    path.join(__dirname, "../.jimeng-session"),
    {
      headless: false,
      viewport: { width: 1280, height: 900 },
    }
  );
  try {
    const page = await browser.newPage();
    await page.goto("https://jimeng.jianying.com");
    // Keep open until Ctrl+C
    await new Promise<void>(() => {});
  } finally {
    // SIGINT will kill process before finally runs, but defensive cleanup
    await browser.close().catch(() => {});
  }
}

async function main() {
  if (process.env.FIRST_LOGIN === "true") {
    return firstLogin();
  }

  try {
    await jimeng.init();
  } catch (err) {
    console.error("Failed to initialize Playwright browser:", err);
    process.exit(1);
  }
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
        const remoteUrl = await jimeng.generateVideo({ content, duration, ratio });

        // Download video to local disk
        const filename = await downloadVideo(remoteUrl, jobId);

        await db.videoJob.update({
          where: { id: jobId },
          data: {
            status: "COMPLETED",
            resultUrl: `/api/videos/${filename}`,
            errorMessage: null,
            completedAt: new Date(),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Content review failures should not be retried
        const isContentReview = err instanceof ContentReviewError;
        const isLastRetry = job.attemptsMade + 1 >= (job.opts.attempts ?? 3);

        await db.videoJob.update({
          where: { id: jobId },
          data: {
            status: isContentReview || isLastRetry ? "FAILED" : "QUEUED",
            retryCount: { increment: 1 },
            errorMessage: isContentReview
              ? `[审核不通过] ${(err as ContentReviewError).reviewMessage}`
              : message,
          },
        });

        if (isContentReview) {
          // Don't throw — skip BullMQ retry for content review failures
          console.log(`[${WORKER_ID}] Job ${jobId} failed content review, skipping retry`);
          return;
        }
        throw err; // Let BullMQ handle retry for other errors
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
