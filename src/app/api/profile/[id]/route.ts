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
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(profile);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.brandProfile.deleteMany({
    where: { id, merchantId: session.user.id },
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const updateData = {
    brandName: typeof body.brandName === "string" ? body.brandName : undefined,
    industry: typeof body.industry === "string" ? body.industry : undefined,
    productDescription:
      typeof body.productDescription === "string" ? body.productDescription : undefined,
    brandPersonality:
      typeof body.brandPersonality === "string" ? body.brandPersonality : undefined,
    coreSellingPoints: Array.isArray(body.coreSellingPoints)
      ? body.coreSellingPoints.filter((item: unknown) => typeof item === "string")
      : undefined,
    targetAudience: typeof body.targetAudience === "string" ? body.targetAudience : undefined,
    recommendedStyles: Array.isArray(body.recommendedStyles)
      ? body.recommendedStyles.filter((item: unknown) => typeof item === "string")
      : undefined,
    videoTone: typeof body.videoTone === "string" ? body.videoTone : undefined,
    complianceNotes: Array.isArray(body.complianceNotes)
      ? body.complianceNotes.filter((item: unknown) => typeof item === "string")
      : undefined,
    logoUrl: typeof body.logoUrl === "string" || body.logoUrl === null ? body.logoUrl : undefined,
  };

  const profile = await db.brandProfile.updateMany({
    where: { id, merchantId: session.user.id },
    data: updateData,
  });
  return NextResponse.json(profile);
}
