import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const profile = await db.brandProfile.findFirst({
    where: { id, merchantId: session.user.id },
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(profile);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  // Remove fields that shouldn't be updated directly
  const { id: _id, merchantId: _mid, createdAt: _ca, ...updateData } = body;

  const profile = await db.brandProfile.updateMany({
    where: { id, merchantId: session.user.id },
    data: updateData,
  });
  return NextResponse.json(profile);
}
