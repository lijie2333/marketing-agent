"use client";
import { useState } from "react";
import StepBasicInfo from "@/components/onboarding/StepBasicInfo";
import StepUpload from "@/components/onboarding/StepUpload";
import StepQuestionnaire from "@/components/onboarding/StepQuestionnaire";
import StepProfile from "@/components/onboarding/StepProfile";

interface BasicInfo {
  brandName: string;
  industry: string;
  products: string;
  platforms: string[];
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<{
    basicInfo?: BasicInfo;
    uploadedFileUrls?: string[];
    questionnaireAnswers?: Record<string, string>;
    profileId?: string;
  }>({});

  const next = (newData: Partial<typeof data>) => {
    setData((prev) => ({ ...prev, ...newData }));
    setStep((s) => s + 1);
  };

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <div className="mb-8">
        <div className="text-sm text-muted-foreground mb-2">步骤 {step} / 4</div>
        <div className="h-2 bg-muted rounded-full">
          <div
            className="h-2 bg-primary rounded-full transition-all"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>
      </div>
      {step === 1 && (
        <StepBasicInfo onNext={(basicInfo) => next({ basicInfo })} />
      )}
      {step === 2 && (
        <StepUpload onNext={(uploadedFileUrls) => next({ uploadedFileUrls })} />
      )}
      {step === 3 && (
        <StepQuestionnaire
          onNext={async (questionnaireAnswers) => {
            const res = await fetch("/api/agent/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                basicInfo: data.basicInfo,
                uploadedFileUrls: data.uploadedFileUrls || [],
                questionnaireAnswers,
              }),
            });
            const json = await res.json();
            next({ questionnaireAnswers, profileId: json.profileId });
          }}
        />
      )}
      {step === 4 && data.profileId && (
        <StepProfile profileId={data.profileId} />
      )}
    </div>
  );
}
