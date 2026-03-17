"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function StrategyPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ id: string; brandPersonality: string } | null>(null);
  const [count, setCount] = useState(50);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/profile").then((r) => r.json()).then(setProfile);
  }, []);

  async function generate() {
    if (!profile) return;
    setLoading(true);
    const res = await fetch("/api/strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: profile.id, totalVideos: count }),
    });
    const { strategyId } = await res.json();
    setLoading(false);
    router.push(`/prompts?strategyId=${strategyId}`);
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <Card>
        <CardHeader><CardTitle>视频策略生成</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {profile ? (
            <p className="text-sm text-muted-foreground">
              品牌：<strong>{profile.brandPersonality}</strong>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">加载品牌画像中...</p>
          )}
          <div>
            <Label>计划生成视频总数</Label>
            <Input
              type="number"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              min={1}
              max={200}
            />
          </div>
          <Button onClick={generate} disabled={!profile || loading} className="w-full">
            {loading ? "AI 生成策略和提示词中..." : "生成提示词"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
