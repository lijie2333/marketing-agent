"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function StepUpload({ onNext }: { onNext: (urls: string[]) => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setUploading(true);
    const newUrls: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.ok) {
        const { url } = await res.json();
        newUrls.push(url);
      }
    }
    setUrls((prev) => [...prev, ...newUrls]);
    setUploading(false);
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
        />
        {uploading && <p className="text-sm text-muted-foreground">上传中...</p>}
        {urls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {urls.map((u, i) => (
              <Badge key={i} variant="secondary">{u.split("/").pop()}</Badge>
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
