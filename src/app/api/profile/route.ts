import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profiles = await db.brandProfile.findMany({
    where: { merchantId: session.user.id },
    select: {
      id: true,
      brandName: true,
      industry: true,
      productDescription: true,
      brandPersonality: true,
      coreSellingPoints: true,
      targetAudience: true,
      recommendedStyles: true,
      videoTone: true,
      complianceNotes: true,
      pdfDigest: true,
      logoUrl: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(profiles);
}
