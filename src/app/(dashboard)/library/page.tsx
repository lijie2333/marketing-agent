"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoJob, JobsResponse } from "@/types/jobs";

export default function LibraryPage() {
  const [completedJobs, setCompletedJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) {
        console.error("Failed to fetch jobs:", res.status);
        return;
      }
      const data: JobsResponse = await res.json();
      setCompletedJobs(data.jobs.filter((j) => j.status === "COMPLETED"));
    } catch (err) {
      console.error("Error fetching library:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  function downloadFile(url: string, name: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleBatchDownload() {
    completedJobs
      .filter((j): j is typeof j & { resultUrl: string } => j.resultUrl !== null)
      .forEach((j) => downloadFile(j.resultUrl, `${j.prompt.direction}-${j.id}.mp4`));
  }

  const hasDownloadableVideos = completedJobs.some((j) => j.resultUrl);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">视频库</h1>
        <Button
          onClick={handleBatchDownload}
          disabled={!hasDownloadableVideos}
          variant="default"
        >
          批量下载
        </Button>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground py-8">加载中...</p>
      ) : completedJobs.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">暂无已完成视频</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {completedJobs.map((job) => (
            <Card key={job.id} className="overflow-hidden">
              <CardContent className="p-0">
                {job.resultUrl ? (
                  <video
                    src={job.resultUrl}
                    controls
                    className="w-full aspect-video object-cover bg-black"
                  />
                ) : (
                  <div className="w-full aspect-video bg-muted flex items-center justify-center">
                    <p className="text-sm text-muted-foreground">视频处理中</p>
                  </div>
                )}
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate flex-1">{job.prompt.direction}</p>
                    {job.resultUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadFile(job.resultUrl!, `${job.prompt.direction}-${job.id}.mp4`)}
                      >
                        下载
                      </Button>
                    )}
                  </div>
                  {job.prompt.script && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {job.prompt.script}
                    </p>
                  )}
                  <Badge variant="secondary">{job.prompt.style}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
