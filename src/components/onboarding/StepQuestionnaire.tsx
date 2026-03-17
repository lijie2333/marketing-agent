"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const QUESTIONS = [
  { key: "targetAudience", label: "您的目标客群是谁？（年龄、性别、职业、兴趣）" },
  { key: "sellingPoints", label: "您产品/服务的核心卖点是什么？（列举3-5个）" },
  { key: "competitors", label: "您的主要竞争对手是谁？您比他们好在哪里？" },
  { key: "videoStyle", label: "您期望的短视频风格是什么？" },
  { key: "volume", label: "每月大概需要生产多少条视频？" },
  { key: "restrictions", label: "有什么内容是绝对不能出现在视频里的？" },
];

export default function StepQuestionnaire({
  onNext,
}: {
  onNext: (answers: Record<string, string>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await onNext(answers);
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader><CardTitle>品牌问卷</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {QUESTIONS.map((q) => (
            <div key={q.key}>
              <Label htmlFor={q.key}>{q.label}</Label>
              <Textarea
                id={q.key}
                value={answers[q.key] || ""}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                rows={3}
                className="mt-1"
              />
            </div>
          ))}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "AI 分析中，请稍候..." : "提交并生成品牌画像"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
