import "dotenv/config";
import { Worker, Job, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { JimengAutomation, ContentReviewError } from "./jimeng";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { URL } from "url";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });
const jimeng = new JimengAutomation();

const WORKER_ID = `worker-${process.pid}`;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "3");
const VIDEOS_DIR = path.resolve(__dirname, "../uploads/videos");

// Base directory for all user uploads (logos, brand materials, etc.)
const UPLOADS_BASE = path.resolve(__dirname, "../uploads");

/** Convert a public URL like /uploads/userId/logos/file.png to an absolute local path */
function resolveUploadPath(publicUrl: string): string {
  const relative = publicUrl.replace(/^\/uploads\//, "");
  return path.join(UPLOADS_BASE, relative);
}

// Ensure videos directory exists
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

/** Download a remote video to local disk, return the local filename */
async function downloadVideo(remoteUrl: string, jobId: string): Promise<string> {
  const filename = `${jobId}.mp4`;
  const filepath = path.join(VIDEOS_DIR, filename);
  console.log(`[download] Downloading ${remoteUrl.substring(0, 80)}... → ${filepath}`);

  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  if (!res.body) throw new Error("Download failed: empty response body");

  await pipeline(
    Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(filepath)
  );

  const stat = fs.statSync(filepath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
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
const dispatchQueue = new Queue("video-generation", { connection: redisConnection });

async function enqueuePromptJob(prompt: {
  id: string;
  content: string;
  duration: number;
  ratio: string;
  referenceImageUrls: string[];
}) {
  const job = await db.videoJob.create({
    data: { promptId: prompt.id, status: "QUEUED" },
  });

  await dispatchQueue.add("generate-video", {
    jobId: job.id,
    promptId: prompt.id,
    content: prompt.content,
    duration: prompt.duration,
    ratio: prompt.ratio,
    referenceImageUrls: prompt.referenceImageUrls,
  });

  return job.id;
}

async function markBatchRunning(promptId: string) {
  const prompt = await db.prompt.findUnique({
    where: { id: promptId },
    select: {
      productionBatchId: true,
      productionPhase: true,
    },
  });

  if (!prompt?.productionBatchId || !prompt.productionPhase) return;

  const nextStatus =
    prompt.productionPhase === "SAMPLE" ? "SAMPLE_RUNNING" : "BULK_RUNNING";
  const currentStatuses =
    prompt.productionPhase === "SAMPLE"
      ? (["SAMPLE_QUEUED", "SAMPLE_REVIEW"] as const)
      : (["BULK_QUEUED", "FAILED"] as const);

  await db.productionBatch.updateMany({
    where: { id: prompt.productionBatchId, status: { in: [...currentStatuses] } },
    data: { status: nextStatus },
  });
}

async function reconcileProductionBatch(promptId: string) {
  const prompt = await db.prompt.findUnique({
    where: { id: promptId },
    select: { productionBatchId: true },
  });

  if (!prompt?.productionBatchId) return;

  const batch = await db.productionBatch.findUnique({
    where: { id: prompt.productionBatchId },
    include: {
      prompts: {
        select: {
          id: true,
          content: true,
          duration: true,
          ratio: true,
          referenceImageUrls: true,
          productionPhase: true,
          videoJob: {
            select: {
              status: true,
            },
          },
        },
      },
    },
  });

  if (!batch) return;

  const samplePrompts = batch.prompts.filter((item) => item.productionPhase === "SAMPLE");
  const bulkPrompts = batch.prompts.filter((item) => item.productionPhase === "BULK");
  const terminalStatuses = new Set(["COMPLETED", "FAILED", "NEEDS_REVIEW"]);

  const sampleAllTerminal =
    samplePrompts.length > 0 &&
    samplePrompts.every((item) => item.videoJob && terminalStatuses.has(item.videoJob.status));
  const sampleAllCompleted =
    samplePrompts.length > 0 &&
    samplePrompts.every((item) => item.videoJob?.status === "COMPLETED");
  const sampleHasFailure = samplePrompts.some(
    (item) => item.videoJob && item.videoJob.status !== "COMPLETED"
  );

  if (sampleHasFailure) {
    await db.productionBatch.update({
      where: { id: batch.id },
      data: { status: "SAMPLE_REVIEW" },
    });
    return;
  }

  if (!sampleAllTerminal) return;

  if (sampleAllCompleted && bulkPrompts.length === 0) {
    await db.productionBatch.update({
      where: { id: batch.id },
      data: {
        status: "COMPLETED",
        sampleCompletedAt: new Date(),
        completedAt: new Date(),
      },
    });
    return;
  }

  if (sampleAllCompleted) {
    const pendingBulkPrompts = bulkPrompts.filter((item) => !item.videoJob);

    if (pendingBulkPrompts.length > 0) {
      await Promise.all(pendingBulkPrompts.map((item) => enqueuePromptJob(item)));
      await db.productionBatch.update({
        where: { id: batch.id },
        data: {
          status: "BULK_QUEUED",
          sampleCompletedAt: new Date(),
          bulkDispatchedAt: new Date(),
        },
      });
      return;
    }

    const bulkStatuses = bulkPrompts.map((item) => item.videoJob?.status ?? null);
    const bulkAllCompleted =
      bulkPrompts.length > 0 && bulkPrompts.every((item) => item.videoJob?.status === "COMPLETED");
    const bulkHasActive = bulkStatuses.some((status) => status === "QUEUED" || status === "PROCESSING");
    const bulkAllTerminal =
      bulkPrompts.length > 0 &&
      bulkPrompts.every((item) => item.videoJob && terminalStatuses.has(item.videoJob.status));

    if (bulkAllCompleted) {
      await db.productionBatch.update({
        where: { id: batch.id },
        data: {
          status: "COMPLETED",
          sampleCompletedAt: batch.sampleCompletedAt ?? new Date(),
          completedAt: new Date(),
        },
      });
      return;
    }

    if (bulkHasActive) {
      await db.productionBatch.update({
        where: { id: batch.id },
        data: { status: "BULK_RUNNING" },
      });
      return;
    }

    if (bulkAllTerminal) {
      await db.productionBatch.update({
        where: { id: batch.id },
        data: { status: "FAILED" },
      });
    }
  }
}

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
    await new Promise<void>((resolve) => {
      const stop = () => resolve();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } finally {
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
      const { jobId, content, duration, ratio, referenceImageUrls } = job.data as {
        jobId: string;
        content: string;
        duration: number;
        ratio: string;
        referenceImageUrls?: string[];
      };

      await db.videoJob.update({
        where: { id: jobId },
        data: { status: "PROCESSING", workerId: WORKER_ID, startedAt: new Date() },
      });
      await markBatchRunning(job.data.promptId as string).catch((error) => {
        console.error(`[${WORKER_ID}] Failed to mark batch running:`, error);
      });

      try {
        const referenceImagePaths = (referenceImageUrls ?? [])
          .map(resolveUploadPath)
          .filter((p) => fs.existsSync(p));

        if ((referenceImageUrls ?? []).length > 0 && referenceImagePaths.length === 0) {
          console.warn(`[${WORKER_ID}] Job ${jobId}: referenceImageUrls specified but no files found locally`);
        }

        const remoteUrl = await jimeng.generateVideo({ content, duration, ratio, referenceImagePaths });

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
        await reconcileProductionBatch(job.data.promptId as string).catch((error) => {
          console.error(`[${WORKER_ID}] Failed to reconcile batch after completion:`, error);
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
          await reconcileProductionBatch(job.data.promptId as string).catch((error) => {
            console.error(`[${WORKER_ID}] Failed to reconcile batch after review rejection:`, error);
          });
          return;
        }
        await reconcileProductionBatch(job.data.promptId as string).catch((error) => {
          console.error(`[${WORKER_ID}] Failed to reconcile batch after failure:`, error);
        });
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
    await dispatchQueue.close();
    await jimeng.close();
    await db.$disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
