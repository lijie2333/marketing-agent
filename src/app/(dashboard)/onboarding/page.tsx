"use client";
import { useState } from "react";
import StepInput from "@/components/onboarding/StepInput";
import StepProfile from "@/components/onboarding/StepProfile";

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInput(data: { description: string; uploadedFileUrls: string[] }) {
    setError(null);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json() as { profileId?: string; error?: string };
      if (!res.ok || !json.profileId) {
        throw new Error(json.error || `请求失败 (${res.status})`);
      }
      setProfileId(json.profileId);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 分析失败，请重试");
      throw err; // Let StepInput catch it to reset loading state
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <div className="mb-8">
        <div className="text-sm text-muted-foreground mb-2">步骤 {step} / 2</div>
        <div className="h-2 bg-muted rounded-full">
          <div
            className="h-2 bg-primary rounded-full transition-all"
            style={{ width: `${(step / 2) * 100}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}
      {step === 1 && <StepInput onNext={handleInput} />}
      {step === 2 && profileId && <StepProfile profileId={profileId} />}
    </div>
  );
}
