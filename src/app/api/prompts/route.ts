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

  const { id, content, script } = await req.json() as { id: string; content?: string; script?: string };
  const data: Record<string, string> = {};
  if (content !== undefined) data.content = content;
  if (script !== undefined) data.script = script;
  await db.prompt.updateMany({
    where: { id, strategy: { brandProfile: { merchantId: session.user.id } } },
    data,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, ids } = await req.json() as { id?: string; ids?: string[] };
  const deleteIds = ids || (id ? [id] : []);
  if (deleteIds.length === 0) return NextResponse.json({ error: "No ids" }, { status: 400 });
  await db.prompt.deleteMany({
    where: { id: { in: deleteIds }, strategy: { brandProfile: { merchantId: session.user.id } } },
  });
  return NextResponse.json({ ok: true });
}
