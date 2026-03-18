"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { JobStatus, VideoJob, JobStats, JobsResponse } from "@/types/jobs";

const statusLabel: Record<JobStatus, string> = {
  QUEUED: "排队中",
  PROCESSING: "生成中",
  COMPLETED: "已完成",
  FAILED: "失败",
  NEEDS_REVIEW: "待审核",
};

const statusColor: Record<JobStatus, string> = {
  QUEUED: "bg-gray-500",
  PROCESSING: "bg-blue-500",
  COMPLETED: "bg-green-500",
  FAILED: "bg-red-500",
  NEEDS_REVIEW: "bg-amber-500",
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [stats, setStats] = useState<JobStats>({ total: 0, queued: 0, processing: 0, completed: 0, failed: 0 });
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) {
        setError("加载失败，请刷新重试");
        return;
      }
      const data: JobsResponse = await res.json();
      setJobs(data.jobs);
      setStats(data.stats);
      setError(null);
    } catch {
      setError("加载失败，请刷新重试");
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleRetry = async (jobId: string) => {
    setRetryingIds((prev) => new Set(prev).add(jobId));
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("Retry failed:", data.error);
        return;
      }
      await fetchJobs();
    } catch (err) {
      console.error("Error retrying job:", err);
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const failedJobs = jobs.filter((j) => j.status === "FAILED");
  const isContentReview = (msg: string | null) => msg?.includes("审核不通过");

  return (
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">任务队列</h1>
        <Button variant="outline" size="sm" onClick={fetchJobs}>刷新</Button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-5 gap-3">
        {([
          { label: "总计", value: stats.total, color: "text-foreground" },
          { label: "排队中", value: stats.queued, color: "text-gray-500" },
          { label: "生成中", value: stats.processing, color: "text-blue-500" },
          { label: "已完成", value: stats.completed, color: "text-green-500" },
          { label: "失败", value: stats.failed, color: "text-red-500" },
        ] as const).map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Failed jobs alert */}
      {failedJobs.length > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-700 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              {failedJobs.length} 个任务生成失败
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {failedJobs.map((job) => (
              <div
                key={job.id}
                className="p-3 bg-white rounded-lg border border-red-200 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">{job.prompt.direction}</Badge>
                      <Badge variant="outline" className="text-xs">{job.prompt.style}</Badge>
                      {isContentReview(job.errorMessage) && (
                        <Badge className="text-xs bg-red-100 text-red-700 border-red-300" variant="outline">
                          审核不通过
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        重试 {job.retryCount} 次
                      </span>
                    </div>
                    {/* Error message */}
                    <p className="text-sm text-red-600 font-medium">
                      {job.errorMessage || "未知错误"}
                    </p>
                    {/* Prompt preview */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(job.id)}
                      className="text-xs text-muted-foreground hover:text-foreground mt-1 underline"
                    >
                      {expandedIds.has(job.id) ? "收起提示词" : "查看提示词"}
                    </button>
                    {expandedIds.has(job.id) && (
                      <div className="mt-2 p-2 bg-muted/50 rounded text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {job.prompt.content}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRetry(job.id)}
                    disabled={retryingIds.has(job.id)}
                    className="flex-shrink-0"
                  >
                    {retryingIds.has(job.id) ? "重试中..." : "重试"}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* All jobs list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">全部任务</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">暂无任务</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((job, idx) => (
                <div
                  key={job.id}
                  className={`p-3 rounded-lg border transition-colors ${
                    job.status === "FAILED"
                      ? "border-red-200 bg-red-50/30"
                      : job.status === "COMPLETED"
                        ? "border-green-200 bg-green-50/30"
                        : job.status === "PROCESSING"
                          ? "border-blue-200 bg-blue-50/30"
                          : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Index */}
                    <span className="text-xs text-muted-foreground w-6 text-right flex-shrink-0">
                      #{idx + 1}
                    </span>

                    {/* Status dot */}
                    <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor[job.status]} ${
                      job.status === "PROCESSING" ? "animate-pulse" : ""
                    }`} />

                    {/* Status label */}
                    <Badge
                      variant={job.status === "FAILED" ? "destructive" : "secondary"}
                      className="text-xs w-14 justify-center flex-shrink-0"
                    >
                      {statusLabel[job.status]}
                    </Badge>

                    {/* Direction + Style */}
                    <div className="flex gap-1.5 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">{job.prompt.direction}</span>
                      <span className="text-xs text-muted-foreground">/</span>
                      <span className="text-xs text-muted-foreground">{job.prompt.style}</span>
                    </div>

                    {/* Prompt preview */}
                    <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                      {job.prompt.content.substring(0, 60)}...
                    </p>

                    {/* Error / result */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {job.status === "FAILED" && (
                        <span className="text-xs text-red-500 max-w-48 truncate" title={job.errorMessage ?? ""}>
                          {isContentReview(job.errorMessage)
                            ? "审核不通过"
                            : (job.errorMessage?.substring(0, 30) ?? "失败")}
                        </span>
                      )}
                      {job.status === "COMPLETED" && job.resultUrl && (
                        <a
                          href={job.resultUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline"
                        >
                          查看视频
                        </a>
                      )}
                      {job.status === "FAILED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleRetry(job.id)}
                          disabled={retryingIds.has(job.id)}
                        >
                          {retryingIds.has(job.id) ? "..." : "重试"}
                        </Button>
                      )}
                      {/* Expand toggle for details */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(job.id)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {expandedIds.has(job.id) ? "▲" : "▼"}
                      </button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {expandedIds.has(job.id) && (
                    <div className="mt-3 ml-9 space-y-2">
                      <div className="text-xs space-y-1 text-muted-foreground">
                        <p>任务 ID: {job.id}</p>
                        <p>创建时间: {new Date(job.createdAt).toLocaleString("zh-CN")}</p>
                        {job.startedAt && <p>开始时间: {new Date(job.startedAt).toLocaleString("zh-CN")}</p>}
                        {job.completedAt && <p>完成时间: {new Date(job.completedAt).toLocaleString("zh-CN")}</p>}
                        {job.retryCount > 0 && <p>已重试: {job.retryCount} 次</p>}
                        {job.workerId && <p>Worker: {job.workerId}</p>}
                      </div>
                      {job.errorMessage && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
                          {job.errorMessage}
                        </div>
                      )}
                      <div className="p-2 bg-muted/50 rounded text-xs leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {job.prompt.content}
                      </div>
                      {job.prompt.script && (
                        <div className="p-2 bg-muted/30 rounded text-xs">
                          <span className="text-muted-foreground">配音文案: </span>{job.prompt.script}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
