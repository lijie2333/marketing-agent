"use client";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Prompt {
  id: string;
  content: string;
  direction: string;
  style: string;
  complianceStatus: string;
  isConfirmed: boolean;
}

function PromptsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const strategyId = searchParams.get("strategyId");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [confirming, setConfirming] = useState(false);

  const fetchPrompts = useCallback(async () => {
    const url = strategyId ? `/api/prompts?strategyId=${strategyId}` : "/api/prompts";
    const res = await fetch(url);
    const data = await res.json();
    setPrompts(data);
  }, [strategyId]);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  async function deletePrompt(id: string) {
    await fetch("/api/prompts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setPrompts((p) => p.filter((x) => x.id !== id));
    selected.delete(id);
    setSelected(new Set(selected));
  }

  async function saveEdit(id: string) {
    await fetch("/api/prompts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: editContent }),
    });
    setPrompts((p) => p.map((x) => x.id === id ? { ...x, content: editContent } : x));
    setEditingId(null);
  }

  async function confirmSelected() {
    if (selected.size === 0 || !strategyId) return;
    setConfirming(true);
    await fetch("/api/prompts/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptIds: Array.from(selected), strategyId }),
    });
    setConfirming(false);
    router.push("/jobs");
  }

  const approvedSelected = Array.from(selected).filter(
    (id) => prompts.find((p) => p.id === id)?.complianceStatus === "APPROVED"
  );

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">提示词管理</h1>
        <Button
          onClick={confirmSelected}
          disabled={approvedSelected.length === 0 || confirming}
        >
          {confirming ? "派发中..." : `确认并开始生产（${approvedSelected.length}条）`}
        </Button>
      </div>
      <div className="space-y-3">
        {prompts.map((p) => (
          <Card key={p.id}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(p.id); else next.delete(p.id);
                    setSelected(next);
                  }}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  {editingId === p.id ? (
                    <div className="space-y-2">
                      <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={4} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(p.id)}>保存</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>取消</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed">{p.content}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">{p.direction}</Badge>
                    <Badge variant="outline" className="text-xs">{p.style}</Badge>
                    <Badge
                      variant={p.complianceStatus === "APPROVED" ? "default" : "destructive"}
                      className="text-xs"
                    >
                      {p.complianceStatus === "APPROVED" ? "合规" : "需审核"}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditingId(p.id); setEditContent(p.content); }}
                  >
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deletePrompt(p.id)}>
                    删除
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function PromptsPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center">加载中...</div>}>
      <PromptsContent />
    </Suspense>
  );
}
