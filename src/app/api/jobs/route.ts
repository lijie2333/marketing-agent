import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { videoQueue } from "@/lib/queue";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await db.videoJob.findMany({
    where: { prompt: { strategy: { brandProfile: { merchantId: session.user.id } } } },
    include: { prompt: { select: { content: true, script: true, direction: true, style: true } } },
    orderBy: { createdAt: "desc" },
  });

  const stats = {
    total: jobs.length,
    queued: jobs.filter((j) => j.status === "QUEUED").length,
    processing: jobs.filter((j) => j.status === "PROCESSING").length,
    completed: jobs.filter((j) => j.status === "COMPLETED").length,
    failed: jobs.filter((j) => j.status === "FAILED").length,
  };

  return NextResponse.json({ jobs, stats });
}

export async function POST(req: NextRequest) {
  // Retry failed jobs
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let jobId: string;
  try {
    const body = await req.json() as { jobId?: unknown };
    if (typeof body.jobId !== "string" || !body.jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    jobId = body.jobId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const job = await db.videoJob.findFirst({
    where: { id: jobId, status: "FAILED", prompt: { strategy: { brandProfile: { merchantId: session.user.id } } } },
    include: { prompt: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found or not retryable" }, { status: 404 });

  await db.videoJob.update({ where: { id: jobId }, data: { status: "QUEUED", retryCount: 0, errorMessage: null } });
  await videoQueue.add("generate-video", { jobId, promptId: job.promptId, content: job.prompt.content, duration: job.prompt.duration, ratio: job.prompt.ratio });

  return NextResponse.json({ ok: true });
}
