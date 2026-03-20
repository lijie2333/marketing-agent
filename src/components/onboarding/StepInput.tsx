"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { uploadFileWithProgress } from "@/lib/upload-client";

type Mode = "description" | "upload";
type UploadStatus = "uploading" | "success" | "error";

interface UploadItem {
  id: string;
  kind: "image" | "pdf";
  name: string;
  progress: number;
  status: UploadStatus;
  url?: string;
  error?: string;
}

interface LogoUploadState {
  error?: string;
  name: string;
  progress: number;
  status: UploadStatus;
}

interface StepInputProps {
  onNext: (data: { description: string; uploadedFileUrls: string[]; logoUrl?: string }) => Promise<void>;
}

export default function StepInput({ onNext }: StepInputProps) {
  const [mode, setMode] = useState<Mode>("description");
  const [description, setDescription] = useState("");
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUpload, setLogoUpload] = useState<LogoUploadState | null>(null);

  const uploadedUrls = uploadItems.flatMap((item) =>
    item.status === "success" && item.url ? [item.url] : []
  );
  const uploading = uploadItems.some((item) => item.status === "uploading");
  const logoUploading = logoUpload?.status === "uploading";

  function createUploadId(file: File) {
    return `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function updateUploadItem(id: string, patch: Partial<UploadItem>) {
    setUploadItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function getStatusLabel(status: UploadStatus) {
    if (status === "success") return "上传完成";
    if (status === "error") return "上传失败";
    return "上传中";
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const nextItems: UploadItem[] = files.map((file) => ({
      id: createUploadId(file),
      kind: file.type === "application/pdf" ? "pdf" : "image",
      name: file.name,
      progress: 0,
      status: "uploading" as const,
    }));

    setUploadItems((prev) => [...prev, ...nextItems]);

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const item = nextItems[index];

      try {
        const { url } = await uploadFileWithProgress({
          file,
          onProgress: (progress) => updateUploadItem(item.id, { progress }),
        });

        updateUploadItem(item.id, {
          progress: 100,
          status: "success",
          url,
        });
      } catch (error) {
        updateUploadItem(item.id, {
          error: error instanceof Error ? error.message : "上传失败，请重试",
          status: "error",
        });
      }
    }

    // reset input so same file can be re-selected
    e.target.value = "";
  }

  function removeFile(id: string) {
    setUploadItems((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLogoUpload({
      name: file.name,
      progress: 0,
      status: "uploading",
    });

    try {
      const { url } = await uploadFileWithProgress({
        endpoint: "/api/upload?type=logo",
        file,
        onProgress: (progress) => {
          setLogoUpload((prev) =>
            prev
              ? {
                  ...prev,
                  progress,
                }
              : prev
          );
        },
      });

      setLogoUrl(url);
      setLogoUpload({
        name: file.name,
        progress: 100,
        status: "success",
      });
    } catch (error) {
      setLogoUpload({
        error: error instanceof Error ? error.message : "上传失败，请重试",
        name: file.name,
        progress: 0,
        status: "error",
      });
    }

    e.target.value = "";
  }

  const canSubmit =
    (mode === "description" && description.trim().length > 10) ||
    (mode === "upload" && uploadedUrls.length > 0);

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await onNext({
        description: mode === "description" ? description.trim() : "",
        uploadedFileUrls: mode === "upload" ? uploadedUrls : [],
        logoUrl: logoUrl ?? undefined,
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
                disabled={uploading}
              />
              <label
                htmlFor="file-upload"
                className={cn("cursor-pointer", uploading && "pointer-events-none opacity-60")}
              >
                <div className="text-3xl mb-2">📄</div>
                <p className="text-sm font-medium">点击选择文件</p>
                <p className="text-xs text-muted-foreground mt-1">
                  支持 PDF（品牌手册）、JPG / PNG / WEBP（产品图片）
                </p>
                <p className="text-xs text-muted-foreground">每个文件最大 10MB，可多选</p>
              </label>
            </div>

            {uploadItems.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  已选择 {uploadItems.length} 个文件，上传成功 {uploadedUrls.length} 个
                </p>
                <div className="space-y-2">
                  {uploadItems.map((item) => (
                    <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
                      <Progress value={item.progress} className="gap-2">
                        <div className="flex items-center justify-between gap-3 w-full">
                          <div className="min-w-0 text-sm flex items-center gap-2">
                            <span>{item.kind === "pdf" ? "📄" : "🖼️"}</span>
                            <span className="truncate">{item.name}</span>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 text-xs",
                              item.status === "success" && "text-emerald-600",
                              item.status === "error" && "text-destructive",
                              item.status === "uploading" && "text-muted-foreground"
                            )}
                          >
                            {getStatusLabel(item.status)}
                          </span>
                        </div>
                      </Progress>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{item.progress}%</span>
                        <button
                          type="button"
                          onClick={() => removeFile(item.id)}
                          disabled={item.status === "uploading"}
                          className="text-xs hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          移除
                        </button>
                      </div>
                      {item.error && (
                        <p className="mt-2 text-xs text-destructive">{item.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {uploading
                ? "正在上传文件，请稍等，进度条会实时显示上传状态"
                : "💡 AI 会自动解析 PDF 文字内容和图片视觉信息，提取品牌关键信息"}
            </p>
          </div>
        )}

        {/* Logo 上传（可选） */}
        <div className="space-y-2 border-t pt-4">
          <Label>品牌 Logo（可选）</Label>
          <p className="text-xs text-muted-foreground">
            上传后 AI 会在每条视频结尾自动生成落版收尾（像广告片片尾一样）
          </p>
          {logoUrl ? (
            <div className="flex items-center gap-3">
              <img src={logoUrl} alt="品牌Logo" className="h-12 w-12 object-contain rounded border" />
              <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                {logoUrl.split("/").pop()}
              </span>
              <button
                type="button"
                onClick={() => {
                  setLogoUrl(null);
                  setLogoUpload(null);
                }}
                className="text-xs text-destructive hover:underline"
              >
                移除
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoFile}
                className="hidden"
                id="logo-upload"
                disabled={logoUploading}
              />
              <label
                htmlFor="logo-upload"
                className={cn(
                  "cursor-pointer text-sm px-3 py-1.5 rounded border border-border hover:border-muted-foreground transition-colors",
                  logoUploading && "pointer-events-none opacity-60"
                )}
              >
                {logoUploading ? "上传中..." : "选择 Logo 图片"}
              </label>
              <span className="text-xs text-muted-foreground">JPG / PNG / WEBP，最大 10MB</span>
            </div>
          )}

          {logoUpload && !logoUrl && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <Progress value={logoUpload.progress} className="gap-2">
                <div className="flex items-center justify-between gap-3 w-full">
                  <span className="truncate text-sm">{logoUpload.name}</span>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      logoUpload.status === "success" && "text-emerald-600",
                      logoUpload.status === "error" && "text-destructive",
                      logoUpload.status === "uploading" && "text-muted-foreground"
                    )}
                  >
                    {getStatusLabel(logoUpload.status)}
                  </span>
                </div>
              </Progress>
              <p className="mt-2 text-xs text-muted-foreground">{logoUpload.progress}%</p>
              {logoUpload.error && (
                <p className="mt-2 text-xs text-destructive">{logoUpload.error}</p>
              )}
            </div>
          )}
        </div>

        <Button
          onClick={handleSubmit}
          className="w-full"
          disabled={!canSubmit || loading || uploading || logoUploading}
        >
          {loading ? "AI 分析中，请稍候..." : "生成品牌画像"}
        </Button>
      </CardContent>
    </Card>
  );
}
