import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobDispatcherSkill } from "@/skills/job-dispatcher";

export const maxDuration = 30;
const SAMPLE_SIZE_PER_DIRECTION = 2;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { promptIds, strategyId } = await req.json() as {
    promptIds: string[];
    strategyId: string;
  };

  try {
    await db.prompt.updateMany({
      where: {
        id: { in: promptIds },
        strategy: { brandProfile: { merchantId: session.user.id } },
        complianceStatus: "APPROVED",
      },
      data: { isConfirmed: true },
    });

    const result = await jobDispatcherSkill.handler({
      strategyId,
      merchantId: session.user.id,
      promptIds: JSON.stringify(promptIds),
      sampleSizePerDirection: String(SAMPLE_SIZE_PER_DIRECTION),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[prompts/confirm] Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
