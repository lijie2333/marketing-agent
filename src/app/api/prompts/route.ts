import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const strategyId = req.nextUrl.searchParams.get("strategyId");
  const prompts = await db.prompt.findMany({
    where: {
      ...(strategyId ? { strategyId } : {}),
      strategy: { brandProfile: { merchantId: session.user.id } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(prompts);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, ...data } = await req.json() as { id: string; [key: string]: unknown };
  await db.prompt.updateMany({
    where: { id, strategy: { brandProfile: { merchantId: session.user.id } } },
    data,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json() as { id: string };
  await db.prompt.deleteMany({
    where: { id, strategy: { brandProfile: { merchantId: session.user.id } } },
  });
  return NextResponse.json({ ok: true });
}
