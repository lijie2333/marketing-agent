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

// Set max duration for this API route (Gemini calls can take a while)
export const maxDuration = 120;

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

  try {
    // Step 1: Generate strategy (1 Gemini call)
    console.log("[strategy] Generating content matrix...");
    const strategyResult = await strategyPlannerSkill.handler({
      brandProfile: JSON.stringify(profile),
      totalVideos: String(totalVideos),
    }) as StrategyResult;
    console.log(`[strategy] Got ${strategyResult.contentMatrix.length} directions`);

    const strategy = await db.videoStrategy.create({
      data: {
        brandProfileId: profileId,
        contentMatrix: strategyResult.contentMatrix as object[],
        keywordPool: strategyResult.keywordPool,
      },
    });

    // Step 2: Generate prompts + scripts for ALL directions in parallel
    console.log("[strategy] Generating prompts for all directions in parallel...");
    const directionTasks = strategyResult.contentMatrix.map(async (dir) => {
      const count = (counts?.[dir.direction] as number) || dir.suggestedCount || 10;
      console.log(`[strategy]   → ${dir.direction} (${count} prompts, style: ${dir.style})`);

      const rawPrompts = await seedancePrompterSkill.handler({
        brandProfile: JSON.stringify(profile),
        direction: dir.direction,
        style: dir.style,
        count: String(Math.min(count, 50)),
        keywordPool: JSON.stringify(strategyResult.keywordPool),
      }) as Array<{ content: string; script: string; duration: number; ratio: string; style: string; direction: string }>;

      console.log(`[strategy]   ✓ ${dir.direction}: generated ${rawPrompts.length} prompts`);

      // Compliance check
      const checked = await complianceCheckerSkill.handler({
        prompts: JSON.stringify(rawPrompts),
      }) as Array<{ content: string; script?: string; complianceStatus: string; duration: number; ratio: string; style: string; direction: string }>;

      console.log(`[strategy]   ✓ ${dir.direction}: compliance checked`);

      // Merge script back, ensure correct types
      return checked.map((p, i) => ({
        content: String(p.content || ""),
        script: String(p.script || rawPrompts[i]?.script || ""),
        duration: Number(p.duration) || 15,
        ratio: String(p.ratio || "9:16"),
        style: String(p.style || dir.style),
        direction: String(p.direction || dir.direction),
        complianceStatus: p.complianceStatus === "APPROVED" ? "APPROVED" as const : "NEEDS_REVIEW" as const,
      }));
    });

    const results = await Promise.all(directionTasks);
    const allPromptData = results.flat();

    console.log(`[strategy] Total prompts generated: ${allPromptData.length}`);

    // Only pick fields that exist in the Prompt model (avoid extra fields from AI response)
    await db.prompt.createMany({
      data: allPromptData.map((p) => ({
        strategyId: strategy.id,
        content: p.content,
        script: p.script || "",
        duration: p.duration,
        ratio: p.ratio,
        style: p.style,
        direction: p.direction,
        complianceStatus: p.complianceStatus,
      })),
    });

    console.log(`[strategy] Done! strategyId=${strategy.id}`);
    return NextResponse.json({ strategyId: strategy.id });
  } catch (err) {
    console.error("[strategy] Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
