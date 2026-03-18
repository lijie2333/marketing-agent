import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brandAnalyzerSkill } from "@/skills/brand-analyzer";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { description, uploadedFileUrls, logoUrl } = await req.json() as {
    description: string;
    uploadedFileUrls?: string[];
    logoUrl?: string;
  };

  try {
    const profileData = await brandAnalyzerSkill.handler({
      description,
      merchantId: session.user.id,
      fileUrls: JSON.stringify(uploadedFileUrls || []),
    }) as {
      brandName: string;
      industry: string;
      productDescription: string;
      brandPersonality: string;
      coreSellingPoints: string[];
      targetAudience: string;
      recommendedStyles: string[];
      videoTone: string;
      complianceNotes: string[];
    };

    const profile = await db.brandProfile.create({
      data: {
        merchantId: session.user.id,
        brandName: profileData.brandName || "",
        industry: profileData.industry || "",
        productDescription: profileData.productDescription || "",
        brandPersonality: profileData.brandPersonality || "",
        coreSellingPoints: profileData.coreSellingPoints || [],
        targetAudience: profileData.targetAudience || "",
        recommendedStyles: profileData.recommendedStyles || [],
        videoTone: profileData.videoTone || "",
        complianceNotes: profileData.complianceNotes || [],
        uploadedFileUrls: uploadedFileUrls || [],
        logoUrl: logoUrl || null,
        questionnaireAnswers: { description },
      },
    });

    return NextResponse.json({ profileId: profile.id, profile });
  } catch (err) {
    console.error("[agent/run] Error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
