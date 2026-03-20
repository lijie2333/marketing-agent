"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PdfBrandDigest } from "@/types/pdf-digest";

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
  pdfDigest?: PdfBrandDigest | null;
  logoUrl?: string | null;
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
        <p className="text-sm text-muted-foreground">
          当前页面展示的是便于确认的摘要版，系统已在后台同步生成详细结构化品牌画像与 Markdown 文档，后续策略和提示词会优先基于那份完整画像生成。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.logoUrl && (
          <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
            <img
              src={profile.logoUrl}
              alt="品牌Logo"
              className="h-12 w-12 object-contain rounded border bg-white"
            />
            <div>
              <p className="text-xs font-medium">品牌 Logo 已上传</p>
              <p className="text-xs text-muted-foreground">视频结尾将自动生成落版收尾</p>
            </div>
          </div>
        )}
        {profile.pdfDigest && (
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">PDF 提炼出的品牌要点</p>
              <p className="text-xs text-muted-foreground mt-1">
                这一部分由 PDF 专职解析智能体生成，用于辅助后续策略和提示词生产
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>公司主体</Label>
                <p className="text-sm mt-1">{profile.pdfDigest.brandFacts.companyName || "未提取到"}</p>
              </div>
              <div>
                <Label>商业模式</Label>
                <p className="text-sm mt-1">{profile.pdfDigest.brandFacts.businessModel || "未提取到"}</p>
              </div>
            </div>
            <div>
              <Label>PDF 证明点</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {profile.pdfDigest.brandFacts.proofPoints.map((point, i) => (
                  <Badge key={i} variant="secondary">{point}</Badge>
                ))}
              </div>
            </div>
            <div>
              <Label>适合短视频的切入角度</Label>
              <ul className="text-sm text-muted-foreground mt-2 list-disc pl-4 space-y-1">
                {profile.pdfDigest.videoMarketingDigest.hookAngles.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <Label>必须提到</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {profile.pdfDigest.videoMarketingDigest.mustMention.map((item, i) => (
                  <Badge key={i} variant="outline">{item}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}
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
