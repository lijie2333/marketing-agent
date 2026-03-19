import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const [
    totalUsers,
    totalJobs,
    completedJobs,
    failedJobs,
    totalPrompts,
    totalStrategies,
    recentJobs,
    users,
  ] = await Promise.all([
    db.merchant.count(),
    db.videoJob.count(),
    db.videoJob.count({ where: { status: "COMPLETED" } }),
    db.videoJob.count({ where: { status: "FAILED" } }),
    db.prompt.count(),
    db.videoStrategy.count(),
    db.videoJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        prompt: {
          select: {
            content: true,
            direction: true,
            style: true,
            strategy: {
              select: {
                brandProfile: {
                  select: { brandName: true, merchant: { select: { name: true, email: true } } },
                },
              },
            },
          },
        },
      },
    }),
    db.merchant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        brandProfiles: {
          include: {
            _count: { select: { strategies: true } },
            strategies: {
              include: {
                prompts: {
                  include: {
                    videoJob: { select: { status: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const usersWithStats = users.map((u: typeof users[number]) => {
    const allPrompts = u.brandProfiles.flatMap((bp) =>
      bp.strategies.flatMap((s) => s.prompts)
    );
    const allJobs = allPrompts.flatMap((p) => (p.videoJob ? [p.videoJob] : []));
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      profiles: u.brandProfiles.length,
      strategies: u.brandProfiles.reduce((acc, bp) => acc + bp.strategies.length, 0),
      prompts: allPrompts.length,
      videos: allJobs.length,
      videosCompleted: allJobs.filter((j) => j.status === "COMPLETED").length,
      videosFailed: allJobs.filter((j) => j.status === "FAILED").length,
    };
  });

  return NextResponse.json({
    stats: {
      totalUsers,
      totalJobs,
      completedJobs,
      failedJobs,
      processingJobs: totalJobs - completedJobs - failedJobs,
      successRate: totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0,
      totalPrompts,
      totalStrategies,
    },
    users: usersWithStats,
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      status: j.status,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
      errorMessage: j.errorMessage,
      resultUrl: j.resultUrl,
      direction: j.prompt.direction,
      style: j.prompt.style,
      contentPreview: j.prompt.content.substring(0, 80),
      brandName: j.prompt.strategy.brandProfile.brandName,
      merchantName: j.prompt.strategy.brandProfile.merchant.name,
      merchantEmail: j.prompt.strategy.brandProfile.merchant.email,
    })),
  });
}
