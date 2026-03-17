import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategyPlannerSkill } from "@/skills/strategy-planner";
import { seedancePrompterSkill } from "@/skills/seedance-prompter";
import { complianceCheckerSkill } from "@/skills/compliance-checker";

interface ContentDirection {
  direction: string;
  style: string;
  duration: number;
  suggestedCount: number;
}

interface StrategyResult {
  contentMatrix: ContentDirection[];
  keywordPool: object;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { profileId, counts, totalVideos: requestedTotal } = await req.json() as {
    profileId: string;
    counts?: Record<string, number>;
    totalVideos?: number;
  };

  const profile = await db.brandProfile.findFirst({
    where: { id: profileId, merchantId: session.user.id },
  });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const totalVideos = requestedTotal ??
    (counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 50);

  // Generate strategy
  const strategyResult = await strategyPlannerSkill.handler({
    brandProfile: JSON.stringify(profile),
    totalVideos: String(totalVideos),
  }) as StrategyResult;

  const strategy = await db.videoStrategy.create({
    data: {
      brandProfileId: profileId,
      contentMatrix: strategyResult.contentMatrix as object[],
      keywordPool: strategyResult.keywordPool,
    },
  });

  // Generate prompts per direction
  const allPromptData: Array<{
    content: string;
    duration: number;
    ratio: string;
    style: string;
    direction: string;
    complianceStatus: "APPROVED" | "NEEDS_REVIEW";
  }> = [];

  for (const dir of strategyResult.contentMatrix) {
    const count = (counts?.[dir.direction] as number) || dir.suggestedCount || 10;
    const rawPrompts = await seedancePrompterSkill.handler({
      brandProfile: JSON.stringify(profile),
      direction: dir.direction,
      style: dir.style,
      duration: String(dir.duration),
      count: String(Math.min(count, 50)),
      keywordPool: JSON.stringify(strategyResult.keywordPool),
    }) as Array<{ content: string; duration: number; ratio: string; style: string; direction: string }>;

    const checked = await complianceCheckerSkill.handler({
      prompts: JSON.stringify(rawPrompts),
    }) as Array<{ content: string; complianceStatus: string; duration: number; ratio: string; style: string; direction: string }>;

    for (const p of checked) {
      allPromptData.push({
        content: p.content,
        duration: p.duration,
        ratio: p.ratio,
        style: p.style,
        direction: p.direction,
        complianceStatus: p.complianceStatus === "APPROVED" ? "APPROVED" : "NEEDS_REVIEW",
      });
    }
  }

  await db.prompt.createMany({
    data: allPromptData.map((p) => ({
      strategyId: strategy.id,
      ...p,
    })),
  });

  return NextResponse.json({ strategyId: strategy.id });
}
