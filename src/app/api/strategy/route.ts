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

interface GeneratedPromptData {
  content: string;
  script: string;
  storyboard?: object;
  duration: number;
  ratio: string;
  style: string;
  direction: string;
  complianceStatus: "APPROVED" | "NEEDS_REVIEW";
  referenceImageUrls: string[];
}

function buildReferenceImageUrls(profile: {
  logoUrl: string | null;
}): string[] {
  return profile.logoUrl ? [profile.logoUrl] : [];
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

  const logoUrl = (profile as Record<string, unknown>).logoUrl as string | undefined ?? undefined;
  const referenceImageUrls = buildReferenceImageUrls({
    logoUrl: profile.logoUrl,
  });
  const brandProfileMarkdown =
    (profile as Record<string, unknown>).brandProfileMarkdown as string | undefined ?? "";
  const strategySystemPrompt =
    (profile as Record<string, unknown>).strategySystemPrompt as string | undefined ?? "";
  const profileSummary = {
    brandName: profile.brandName,
    industry: profile.industry,
    productDescription: profile.productDescription,
    brandPersonality: profile.brandPersonality,
    coreSellingPoints: profile.coreSellingPoints,
    targetAudience: profile.targetAudience,
    recommendedStyles: profile.recommendedStyles,
    videoTone: profile.videoTone,
    complianceNotes: profile.complianceNotes,
    logoUrl,
  };

  const totalVideos = requestedTotal ??
    (counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 50);

  try {
    // Step 1: Generate strategy (1 Gemini call)
    console.log("[strategy] Generating content matrix...");
    const strategyResult = await strategyPlannerSkill.handler({
      brandProfile: JSON.stringify(profileSummary),
      brandProfileMarkdown,
      strategySystemPrompt,
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

    // Step 2: Generate prompts direction by direction.
    // This is intentionally sequential to reduce Gemini fan-out and avoid one flaky branch
    // taking down the entire strategy build.
    console.log("[strategy] Generating prompts direction by direction...");
    const allPromptData: GeneratedPromptData[] = [];
    const failedDirections: Array<{ direction: string; error: string }> = [];

    for (const dir of strategyResult.contentMatrix) {
      const count = (counts?.[dir.direction] as number) || dir.suggestedCount || 10;
      console.log(`[strategy]   → ${dir.direction} (${count} prompts, style: ${dir.style})`);
      try {
        const rawPrompts = await seedancePrompterSkill.handler({
          brandProfile: JSON.stringify(profileSummary),
          brandProfileMarkdown,
          direction: dir.direction,
          style: dir.style,
          count: String(Math.min(count, 50)),
          keywordPool: JSON.stringify(strategyResult.keywordPool),
          logoUrl,
        }) as Array<{
          content: string;
          script: string;
          storyboard?: object;
          duration: number;
          ratio: string;
          style: string;
          direction: string;
          referenceImageUrls: string[];
        }>;

        console.log(`[strategy]   ✓ ${dir.direction}: generated ${rawPrompts.length} prompts`);

        const checked = await complianceCheckerSkill.handler({
          prompts: JSON.stringify(rawPrompts),
        }) as Array<{
          content: string;
          script?: string;
          storyboard?: object;
          complianceStatus: string;
          duration: number;
          ratio: string;
          style: string;
          direction: string;
        }>;

        console.log(`[strategy]   ✓ ${dir.direction}: compliance checked`);

        allPromptData.push(
          ...checked.map((p, i) => ({
            content: String(p.content || ""),
            script: String(p.script || rawPrompts[i]?.script || ""),
            storyboard: p.storyboard ?? rawPrompts[i]?.storyboard,
            duration: Number(p.duration) || 15,
            ratio: String(p.ratio || "9:16"),
            style: String(p.style || dir.style),
            direction: String(p.direction || dir.direction),
            complianceStatus: p.complianceStatus === "APPROVED" ? "APPROVED" as const : "NEEDS_REVIEW" as const,
            referenceImageUrls,
          }))
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[strategy]   ✗ ${dir.direction}:`, error);
        failedDirections.push({
          direction: dir.direction,
          error: message,
        });
      }
    }

    console.log(`[strategy] Total prompts generated: ${allPromptData.length}`);

    if (allPromptData.length === 0) {
      throw new Error(
        failedDirections.length > 0
          ? `所有方向生成失败：${failedDirections.map((item) => `${item.direction}（${item.error}）`).join("；")}`
          : "未生成任何提示词"
      );
    }

    // Only pick fields that exist in the Prompt model (avoid extra fields from AI response)
    await db.prompt.createMany({
      data: allPromptData.map((p) => ({
        strategyId: strategy.id,
        content: p.content,
        script: p.script || "",
        storyboard: p.storyboard,
        duration: p.duration,
        ratio: p.ratio,
        style: p.style,
        direction: p.direction,
        complianceStatus: p.complianceStatus,
        referenceImageUrls: p.referenceImageUrls,
      })),
    });

    console.log(`[strategy] Done! strategyId=${strategy.id}`);
    return NextResponse.json({
      strategyId: strategy.id,
      failedDirections,
      generatedPromptCount: allPromptData.length,
    });
  } catch (err) {
    console.error("[strategy] Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
