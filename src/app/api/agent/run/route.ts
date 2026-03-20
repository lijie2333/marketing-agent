import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brandAnalyzerSkill } from "@/skills/brand-analyzer";
import type { PdfBrandDigest } from "@/types/pdf-digest";

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
      logoUrl: logoUrl || "",
    }) as {
      summary: {
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
      detailedProfile: object;
      brandProfileMarkdown: string;
      strategySystemPrompt: string;
      pdfDigest?: PdfBrandDigest | null;
    };

    const profile = await db.brandProfile.create({
      data: {
        merchantId: session.user.id,
        brandName: profileData.summary.brandName || "",
        industry: profileData.summary.industry || "",
        productDescription: profileData.summary.productDescription || "",
        brandPersonality: profileData.summary.brandPersonality || "",
        coreSellingPoints: profileData.summary.coreSellingPoints || [],
        targetAudience: profileData.summary.targetAudience || "",
        recommendedStyles: profileData.summary.recommendedStyles || [],
        videoTone: profileData.summary.videoTone || "",
        complianceNotes: profileData.summary.complianceNotes || [],
        detailedProfile: profileData.detailedProfile,
        pdfDigest: profileData.pdfDigest ?? undefined,
        brandProfileMarkdown: profileData.brandProfileMarkdown || "",
        strategySystemPrompt: profileData.strategySystemPrompt || "",
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
