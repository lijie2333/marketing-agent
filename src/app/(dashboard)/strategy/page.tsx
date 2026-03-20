"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Profile {
  id: string;
  brandName: string;
  industry: string;
  brandPersonality: string;
  coreSellingPoints: string[];
  recommendedStyles: string[];
  createdAt: string;
}

function StrategyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("profileId");

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(preselectedId);
  const [count, setCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: Profile[]) => {
        setProfiles(data);
        if (!selectedId && data.length > 0) {
          setSelectedId(data[0].id);
        }
        setLoadingProfiles(false);
      });
  }, [selectedId]);

  const selectedProfile = profiles.find((p) => p.id === selectedId);

  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: selectedId, totalVideos: count }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `请求失败 (${res.status})`);
      }
      const { strategyId, failedDirections, generatedPromptCount } = await res.json() as {
        strategyId: string;
        failedDirections?: Array<{ direction: string; error: string }>;
        generatedPromptCount?: number;
      };
      if (failedDirections && failedDirections.length > 0) {
        setWarning(
          `已生成 ${generatedPromptCount ?? 0} 条提示词，但有部分方向失败：${failedDirections
            .map((item) => item.direction)
            .join("、")}`
        );
      }
      router.push(`/prompts?strategyId=${strategyId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请重试");
      setLoading(false);
    }
  }

  if (loadingProfiles) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <p className="text-muted-foreground">加载品牌画像中...</p>
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">还没有品牌画像，请先创建</p>
            <Button onClick={() => router.push("/onboarding")}>去创建品牌画像</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-4">
      {/* 选择品牌画像 */}
      <Card>
        <CardHeader>
          <CardTitle>选择品牌画像</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                selectedId === p.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{p.brandName || p.brandPersonality}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(p.createdAt).toLocaleDateString("zh-CN")}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {p.recommendedStyles.map((s, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                ))}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* 生成配置 */}
      <Card>
        <CardHeader><CardTitle>视频策略生成</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {selectedProfile && (
            <div className="text-sm">
              <span className="text-muted-foreground">当前画像：</span>
              <strong>{selectedProfile.brandName || selectedProfile.brandPersonality}</strong>
              <span className="text-muted-foreground ml-2">
                {selectedProfile.industry && `· ${selectedProfile.industry} `}
                · 卖点：{selectedProfile.coreSellingPoints.slice(0, 3).join("、")}
              </span>
            </div>
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
            <p className="text-xs text-muted-foreground mt-1">
              AI 会优先读取后台沉淀的完整品牌画像 Markdown，并自动分配到不同方向；每条提示词对应 15 秒竖屏视频
            </p>
          </div>
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}
          {warning && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-700">
              {warning}
            </div>
          )}
          <Button onClick={generate} disabled={!selectedId || loading} className="w-full">
            {loading ? "AI 生成策略、提示词和文案中（约30-60秒）..." : "生成提示词和配音文案"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function StrategyPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto py-10 px-4"><p className="text-muted-foreground">加载中...</p></div>}>
      <StrategyContent />
    </Suspense>
  );
}
