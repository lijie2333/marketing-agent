import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brandAnalyzerSkill } from "@/skills/brand-analyzer";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { basicInfo, uploadedFileUrls, questionnaireAnswers } = await req.json();

  try {
    const profileData = await brandAnalyzerSkill.handler({
      basicInfo: JSON.stringify(basicInfo),
      fileUrls: JSON.stringify(uploadedFileUrls || []),
      questionnaireAnswers: JSON.stringify(questionnaireAnswers),
    }) as {
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
        ...profileData,
        uploadedFileUrls: uploadedFileUrls || [],
        questionnaireAnswers,
      },
    });

    return NextResponse.json({ profileId: profile.id, profile });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
