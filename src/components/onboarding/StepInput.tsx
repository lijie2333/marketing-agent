"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Mode = "description" | "upload";

interface StepInputProps {
  onNext: (data: { description: string; uploadedFileUrls: string[] }) => Promise<void>;
}

export default function StepInput({ onNext }: StepInputProps) {
  const [mode, setMode] = useState<Mode>("description");
  const [description, setDescription] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    const newUrls: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.ok) {
        const { url } = await res.json() as { url: string };
        newUrls.push(url);
      }
    }
    setUrls((prev) => [...prev, ...newUrls]);
    setUploading(false);
    // reset input so same file can be re-selected
    e.target.value = "";
  }

  function removeFile(index: number) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }

  const canSubmit =
    (mode === "description" && description.trim().length > 10) ||
    (mode === "upload" && urls.length > 0);

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await onNext({
        description: mode === "description" ? description.trim() : "",
        uploadedFileUrls: mode === "upload" ? urls : [],
      });
    } catch {
      // Error is handled by parent, just reset loading
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>告诉我们你的品牌和视频需求</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          选择一种方式提供品牌信息，AI 将自动生成品牌画像
        </p>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Mode tabs */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode("description")}
            className={`p-4 rounded-lg border-2 text-left transition-colors ${
              mode === "description"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <div className="text-2xl mb-1">✏️</div>
            <div className="font-medium text-sm">自由描述</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              用文字描述你的品牌、产品和视频需求
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={`p-4 rounded-lg border-2 text-left transition-colors ${
              mode === "upload"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <div className="text-2xl mb-1">📁</div>
            <div className="font-medium text-sm">上传品牌资料</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              上传品牌手册、产品图片，AI 自动解析
            </div>
          </button>
        </div>

        {/* Description mode */}
        {mode === "description" && (
          <div className="space-y-2">
            <Label htmlFor="description">品牌描述</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={7}
              placeholder="请描述你的品牌情况，例如：&#10;&#10;我们是一家做原创女装的品牌，主打通勤风，目标用户是25-35岁的职场女性。产品核心卖点是面料舒适、版型好、价格亲民。希望视频有质感、不浮夸，突出面料细节和穿搭场景。主要在抖音和小红书投放。禁忌：不要出现过于性感或夸张的造型。"
              className="mt-1 resize-none"
            />
            <p className="text-xs text-muted-foreground">
              包括：品牌故事、产品特点、目标用户、视频风格偏好、禁忌内容等，越详细越好
            </p>
          </div>
        )}

        {/* Upload mode */}
        {mode === "upload" && (
          <div className="space-y-3">
            <Label>品牌资料文件</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-muted-foreground transition-colors">
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                multiple
                onChange={handleFiles}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <div className="text-3xl mb-2">📄</div>
                <p className="text-sm font-medium">点击选择文件</p>
                <p className="text-xs text-muted-foreground mt-1">
                  支持 PDF（品牌手册）、JPG / PNG / WEBP（产品图片）
                </p>
                <p className="text-xs text-muted-foreground">每个文件最大 10MB，可多选</p>
              </label>
            </div>

            {uploading && (
              <p className="text-sm text-muted-foreground animate-pulse">上传中...</p>
            )}

            {urls.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">已上传 {urls.length} 个文件（点击 ✕ 删除）：</p>
                <div className="flex flex-wrap gap-2">
                  {urls.map((u, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
                      onClick={() => removeFile(i)}
                    >
                      {u.endsWith(".pdf") ? "📄" : "🖼️"} {u.split("/").pop()} ✕
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              💡 AI 会自动解析 PDF 文字内容和图片视觉信息，提取品牌关键信息
            </p>
          </div>
        )}

        <Button
          onClick={handleSubmit}
          className="w-full"
          disabled={!canSubmit || loading || uploading}
        >
          {loading ? "AI 分析中，请稍候..." : "生成品牌画像"}
        </Button>
      </CardContent>
    </Card>
  );
}
