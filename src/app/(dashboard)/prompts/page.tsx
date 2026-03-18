"use client";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Prompt {
  id: string;
  strategyId: string;
  content: string;
  script: string;
  direction: string;
  style: string;
  complianceStatus: string;
  isConfirmed: boolean;
}

type DispatchState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "dispatching"; message: string }
  | { status: "success"; dispatched: number }
  | { status: "error"; message: string };

function PromptsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const strategyId = searchParams.get("strategyId");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editScript, setEditScript] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatch, setDispatch] = useState<DispatchState>({ status: "idle" });

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
      body: JSON.stringify({ id, content: editContent, script: editScript }),
    });
    setPrompts((p) => p.map((x) => x.id === id ? { ...x, content: editContent, script: editScript } : x));
    setEditingId(null);
  }

  // Derive strategyId from selected prompts (no longer depends on URL param)
  function getStrategyIds(): string[] {
    const ids = new Set<string>();
    for (const id of selected) {
      const p = prompts.find((x) => x.id === id);
      if (p) ids.add(p.strategyId);
    }
    return Array.from(ids);
  }

  // Step 1: Show confirmation dialog
  function handleConfirmClick() {
    if (selected.size === 0) {
      setError("请先选择要派发的提示词");
      return;
    }
    setError(null);
    setDispatch({ status: "confirming" });
  }

  // Step 2: Actually dispatch (supports multiple strategyIds)
  async function doDispatch() {
    const strategyIds = getStrategyIds();
    if (strategyIds.length === 0) return;
    setDispatch({ status: "dispatching", message: "正在标记提示词并派发任务到生成队列..." });
    try {
      let totalDispatched = 0;
      for (const sid of strategyIds) {
        const idsForStrategy = Array.from(selected).filter(
          (id) => prompts.find((x) => x.id === id)?.strategyId === sid
        );
        const res = await fetch("/api/prompts/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promptIds: idsForStrategy, strategyId: sid }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `请求失败 (${res.status})`);
        }
        const data = await res.json() as { dispatched?: number; error?: string };
        if (data.error) throw new Error(data.error);
        totalDispatched += data.dispatched ?? 0;
      }
      if (totalDispatched === 0) {
        setDispatch({ status: "error", message: "没有可派发的提示词。可能原因：提示词未通过合规审核，或已经派发过。" });
        return;
      }
      setDispatch({ status: "success", dispatched: totalDispatched });
    } catch (err) {
      setDispatch({ status: "error", message: err instanceof Error ? err.message : "派发失败，请检查 Redis 服务是否运行" });
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`确定删除选中的 ${selected.size} 条提示词？此操作不可撤销。`)) return;
    setDeleting(true);
    await fetch("/api/prompts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    setPrompts((p) => p.filter((x) => !selected.has(x.id)));
    setSelected(new Set());
    setDeleting(false);
  }

  function selectAll() {
    if (selected.size === prompts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(prompts.map((p) => p.id)));
    }
  }

  const approvedCount = Array.from(selected).filter(
    (id) => prompts.find((p) => p.id === id)?.complianceStatus === "APPROVED"
  ).length;
  const needsReviewCount = selected.size - approvedCount;

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      {/* Dispatch overlay dialog */}
      {dispatch.status !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
            {dispatch.status === "confirming" && (
              <>
                <h3 className="text-lg font-bold">确认派发任务</h3>
                <div className="space-y-2 text-sm">
                  <p>已选择 <strong>{selected.size}</strong> 条提示词：</p>
                  <div className="flex gap-3">
                    <span className="text-green-600">合规通过：{approvedCount} 条</span>
                    {needsReviewCount > 0 && (
                      <span className="text-amber-600">待审核：{needsReviewCount} 条（将跳过）</span>
                    )}
                  </div>
                  {approvedCount === 0 && (
                    <p className="text-destructive font-medium">没有合规通过的提示词可派发，请先审核。</p>
                  )}
                  <p className="text-muted-foreground">
                    确认后将派发 {approvedCount} 条合规通过的提示词到视频生成队列。
                  </p>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="outline" onClick={() => setDispatch({ status: "idle" })}>
                    取消
                  </Button>
                  <Button onClick={doDispatch} disabled={approvedCount === 0}>
                    确认派发（{approvedCount} 条）
                  </Button>
                </div>
              </>
            )}

            {dispatch.status === "dispatching" && (
              <div className="text-center py-4 space-y-3">
                <div className="inline-block w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-medium">{dispatch.message}</p>
              </div>
            )}

            {dispatch.status === "success" && (
              <>
                <div className="text-center py-2 space-y-3">
                  <div className="text-4xl">&#10003;</div>
                  <h3 className="text-lg font-bold text-green-600">派发成功！</h3>
                  <p className="text-sm text-muted-foreground">
                    已将 <strong>{dispatch.dispatched}</strong> 条提示词加入视频生成队列。
                    Worker 服务会自动开始处理。
                  </p>
                </div>
                <div className="flex gap-2 justify-center pt-2">
                  <Button variant="outline" onClick={() => setDispatch({ status: "idle" })}>
                    留在当前页
                  </Button>
                  <Button onClick={() => router.push("/jobs")}>
                    查看任务队列
                  </Button>
                </div>
              </>
            )}

            {dispatch.status === "error" && (
              <>
                <div className="text-center py-2 space-y-3">
                  <div className="text-4xl">&#10007;</div>
                  <h3 className="text-lg font-bold text-destructive">派发失败</h3>
                  <p className="text-sm text-muted-foreground">{dispatch.message}</p>
                </div>
                <div className="flex gap-2 justify-center pt-2">
                  <Button variant="outline" onClick={() => setDispatch({ status: "idle" })}>
                    关闭
                  </Button>
                  <Button onClick={doDispatch}>重试</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">提示词 & 文案管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {prompts.length} 条，已选 {selected.size} 条
            {selected.size > 0 && approvedCount < selected.size && (
              <span className="text-amber-600 ml-1">
                （其中 {needsReviewCount} 条待审核）
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll}>
            {selected.size === prompts.length && prompts.length > 0 ? "取消全选" : "全选"}
          </Button>
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={deleteSelected} disabled={deleting}>
              {deleting ? "删除中..." : `删除选中（${selected.size}条）`}
            </Button>
          )}
          <Button onClick={handleConfirmClick} disabled={selected.size === 0}>
            确认并开始生产（{selected.size}条）
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Prompt list */}
      <div className="space-y-3">
        {prompts.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            暂无提示词
          </div>
        )}
        {prompts.map((p, idx) => (
          <Card key={p.id} className={p.isConfirmed ? "opacity-60" : ""}>
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
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">视频提示词</Label>
                        <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={4} />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          配音文案（{editScript.replace(/\[.*?\]\s*/g, "").length} 字，建议 45-60 字）
                        </Label>
                        <Textarea
                          value={editScript}
                          onChange={(e) => setEditScript(e.target.value)}
                          rows={2}
                          placeholder="[旁白] 你的配音文案..."
                        />
                        {editScript.replace(/\[.*?\]\s*/g, "").length > 60 && (
                          <p className="text-xs text-destructive mt-1">文案超过 60 字，15秒内可能读不完</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(p.id)}>保存</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>取消</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-muted-foreground mb-1 font-medium">
                        #{idx + 1} 视频提示词
                        {p.isConfirmed && <span className="ml-2 text-green-600">（已派发）</span>}
                      </div>
                      <p className="text-sm leading-relaxed">{p.content}</p>
                      {p.script && (
                        <div className="mt-3 p-3 bg-muted/50 rounded-lg border">
                          <div className="text-xs text-muted-foreground mb-1 font-medium">
                            配音文案（{p.script.replace(/\[.*?\]\s*/g, "").length} 字）
                          </div>
                          <p className="text-sm leading-relaxed">{p.script}</p>
                        </div>
                      )}
                    </>
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
                    onClick={() => { setEditingId(p.id); setEditContent(p.content); setEditScript(p.script || ""); }}
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
