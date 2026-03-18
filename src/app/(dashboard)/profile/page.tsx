"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface BrandProfile {
  id: string;
  brandName: string;
  industry: string;
  productDescription: string;
  brandPersonality: string;
  coreSellingPoints: string[];
  targetAudience: string;
  recommendedStyles: string[];
  videoTone: string;
  complianceNotes: string[];
  createdAt: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<BrandProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile");
      const data = await res.json() as BrandProfile[];
      setProfiles(data);
    } catch {
      console.error("Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  async function handleDelete(id: string) {
    if (!confirm("确定要删除这个品牌画像吗？关联的策略和提示词也会受影响。")) return;
    setDeleting(id);
    await fetch(`/api/profile/${id}`, { method: "DELETE" });
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    setDeleting(null);
  }

  function handleUse(id: string) {
    router.push(`/strategy?profileId=${id}`);
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-10 px-4">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">品牌画像</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理你的品牌画像，选择一个进入策略生成
          </p>
        </div>
        <Button onClick={() => router.push("/onboarding")}>
          + 创建新画像
        </Button>
      </div>

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">还没有品牌画像</p>
            <Button onClick={() => router.push("/onboarding")}>
              去创建第一个品牌画像
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {profiles.map((profile, index) => (
            <Card
              key={profile.id}
              className={index === 0 ? "border-primary" : ""}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-lg">
                      {profile.brandName || profile.brandPersonality}
                    </CardTitle>
                    {profile.industry && (
                      <Badge variant="outline" className="text-xs">{profile.industry}</Badge>
                    )}
                    {index === 0 && (
                      <Badge variant="default" className="text-xs">最新</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(profile.createdAt).toLocaleDateString("zh-CN", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 产品描述 */}
                {profile.productDescription && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">产品/服务</p>
                    <p className="text-sm">{profile.productDescription}</p>
                  </div>
                )}

                {/* 品牌人格 + 视频基调 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">品牌人格</p>
                    <p className="text-sm">{profile.brandPersonality}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">视频基调</p>
                    <p className="text-sm">{profile.videoTone}</p>
                  </div>
                </div>

                {/* 核心卖点 */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">核心卖点</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.coreSellingPoints.map((point, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{point}</Badge>
                    ))}
                  </div>
                </div>

                {/* 目标受众 */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">目标受众</p>
                  <p className="text-sm">{profile.targetAudience}</p>
                </div>

                {/* 推荐风格 */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">推荐视频风格</p>
                  <div className="flex flex-wrap gap-1">
                    {profile.recommendedStyles.map((style, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{style}</Badge>
                    ))}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => handleUse(profile.id)} className="flex-1">
                    使用此画像生成策略
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleDelete(profile.id)}
                    disabled={deleting === profile.id}
                    className="text-destructive hover:text-destructive"
                  >
                    {deleting === profile.id ? "删除中..." : "删除"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
