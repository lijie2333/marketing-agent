"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { uploadFileWithProgress } from "@/lib/upload-client";

type UploadStatus = "uploading" | "success" | "error";

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  status: UploadStatus;
  url?: string;
  error?: string;
}

export default function StepUpload({ onNext }: { onNext: (urls: string[]) => void }) {
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const urls = uploadItems.flatMap((item) =>
    item.status === "success" && item.url ? [item.url] : []
  );
  const uploading = uploadItems.some((item) => item.status === "uploading");

  function createUploadId(file: File) {
    return `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function updateUploadItem(id: string, patch: Partial<UploadItem>) {
    setUploadItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const nextItems = files.map((file) => ({
      id: createUploadId(file),
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

    e.target.value = "";
  }

  return (
    <Card>
      <CardHeader><CardTitle>上传品牌资料</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          支持上传品牌手册（PDF）、产品图片（JPG/PNG/WEBP），每个文件最大10MB
        </p>
        <input
          type="file"
          accept=".pdf,image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFiles}
          className="block w-full text-sm"
          disabled={uploading}
        />
        {uploadItems.length > 0 && (
          <div className="space-y-2">
            {uploadItems.map((item) => (
              <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
                <Progress value={item.progress} className="gap-2">
                  <div className="flex items-center justify-between gap-3 w-full">
                    <span className="truncate text-sm">{item.name}</span>
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        item.status === "success" && "text-emerald-600",
                        item.status === "error" && "text-destructive",
                        item.status === "uploading" && "text-muted-foreground"
                      )}
                    >
                      {item.status === "success"
                        ? "上传完成"
                        : item.status === "error"
                          ? "上传失败"
                          : "上传中"}
                    </span>
                  </div>
                </Progress>
                <p className="mt-2 text-xs text-muted-foreground">{item.progress}%</p>
                {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
              </div>
            ))}
          </div>
        )}
        <Button onClick={() => onNext(urls)} className="w-full">
          {urls.length > 0 ? `继续（已上传${urls.length}个文件）` : "跳过（无资料）"}
        </Button>
      </CardContent>
    </Card>
  );
}
