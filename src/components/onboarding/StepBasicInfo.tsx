"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface BasicInfo {
  brandName: string;
  industry: string;
  products: string;
  platforms: string[];
}

export default function StepBasicInfo({ onNext }: { onNext: (data: BasicInfo) => void }) {
  const [platforms, setPlatforms] = useState<string[]>([]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onNext({
      brandName: fd.get("brandName") as string,
      industry: fd.get("industry") as string,
      products: fd.get("products") as string,
      platforms,
    });
  }

  function togglePlatform(p: string) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

  return (
    <Card>
      <CardHeader><CardTitle>基础信息</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="brandName">品牌名称</Label>
            <Input id="brandName" name="brandName" required />
          </div>
          <div>
            <Label htmlFor="industry">行业</Label>
            <Input id="industry" name="industry" required />
          </div>
          <div>
            <Label htmlFor="products">主营产品/服务</Label>
            <Input id="products" name="products" required />
          </div>
          <div>
            <Label>目标投放平台</Label>
            <div className="flex gap-3 mt-2">
              {["抖音", "小红书", "视频号"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`px-4 py-2 rounded border text-sm ${
                    platforms.includes(p)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" className="w-full">下一步</Button>
        </form>
      </CardContent>
    </Card>
  );
}
