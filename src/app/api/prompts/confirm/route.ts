import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobDispatcherSkill } from "@/skills/job-dispatcher";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { promptIds, strategyId } = await req.json() as {
    promptIds: string[];
    strategyId: string;
  };

  await db.prompt.updateMany({
    where: {
      id: { in: promptIds },
      strategy: { brandProfile: { merchantId: session.user.id } },
      complianceStatus: "APPROVED",
    },
    data: { isConfirmed: true },
  });

  const result = await jobDispatcherSkill.handler({ strategyId });
  return NextResponse.json(result);
}
