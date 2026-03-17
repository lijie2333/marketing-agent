import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await db.brandProfile.findFirst({
    where: { merchantId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(profile);
}
