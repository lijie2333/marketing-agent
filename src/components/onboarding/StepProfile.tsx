"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
}

export default function StepProfile({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/profile/${profileId}`)
      .then((r) => r.json())
      .then(setProfile);
  }, [profileId]);

  async function handleConfirm() {
    if (!profile) return;
    setSaving(true);
    await fetch(`/api/profile/${profileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    setSaving(false);
    router.push("/profile");
  }

  if (!profile) return <p className="text-center py-10">加载中...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>品牌画像（可编辑后确认）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>品牌名称</Label>
            <Input
              value={profile.brandName}
              onChange={(e) => setProfile((p) => p && { ...p, brandName: e.target.value })}
            />
          </div>
          <div>
            <Label>所属行业</Label>
            <Input
              value={profile.industry}
              onChange={(e) => setProfile((p) => p && { ...p, industry: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label>产品/服务描述</Label>
          <Textarea
            value={profile.productDescription}
            onChange={(e) => setProfile((p) => p && { ...p, productDescription: e.target.value })}
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>品牌人格</Label>
            <Input
              value={profile.brandPersonality}
              onChange={(e) => setProfile((p) => p && { ...p, brandPersonality: e.target.value })}
            />
          </div>
          <div>
            <Label>视频基调</Label>
            <Input
              value={profile.videoTone}
              onChange={(e) => setProfile((p) => p && { ...p, videoTone: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label>目标受众</Label>
          <Textarea
            value={profile.targetAudience}
            onChange={(e) => setProfile((p) => p && { ...p, targetAudience: e.target.value })}
            rows={2}
          />
        </div>
        <div>
          <Label>核心卖点</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {profile.coreSellingPoints.map((p, i) => (
              <Badge key={i} variant="outline">{p}</Badge>
            ))}
          </div>
        </div>
        <div>
          <Label>推荐视频风格</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {profile.recommendedStyles.map((s, i) => (
              <Badge key={i}>{s}</Badge>
            ))}
          </div>
        </div>
        {profile.complianceNotes.length > 0 && (
          <div>
            <Label>合规注意事项</Label>
            <ul className="text-sm text-muted-foreground mt-1 list-disc pl-4">
              {profile.complianceNotes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        )}
        <Button onClick={handleConfirm} className="w-full" disabled={saving}>
          {saving ? "保存中..." : "确认品牌画像"}
        </Button>
      </CardContent>
    </Card>
  );
}
