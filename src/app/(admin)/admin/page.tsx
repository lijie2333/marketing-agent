"use client";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Admin page lives at /admin with its own dark layout (src/app/(admin)/layout.tsx)

interface Stats {
  totalUsers: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  processingJobs: number;
  successRate: number;
  totalPrompts: number;
  totalStrategies: number;
}

interface UserStat {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  profiles: number;
  strategies: number;
  prompts: number;
  videos: number;
  videosCompleted: number;
  videosFailed: number;
}

interface RecentJob {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  resultUrl: string | null;
  direction: string;
  style: string;
  contentPreview: string;
  brandName: string;
  merchantName: string;
  merchantEmail: string;
}

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  QUEUED: "bg-yellow-100 text-yellow-800",
  NEEDS_REVIEW: "bg-orange-100 text-orange-800",
};

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "已完成",
  FAILED: "失败",
  PROCESSING: "生成中",
  QUEUED: "排队中",
  NEEDS_REVIEW: "待审核",
};

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserStat[]>([]);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "jobs">("overview");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stats");
      const data = await res.json() as { stats: Stats; users: UserStat[]; recentJobs: RecentJob[] };
      setStats(data.stats);
      setUsers(data.users);
      setRecentJobs(data.recentJobs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="max-w-6xl mx-auto py-10 px-4 text-muted-foreground">加载中...</div>;
  if (!stats) return null;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">管理后台</h1>
          <p className="text-sm text-muted-foreground mt-1">所有用户的使用数据总览</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>刷新</Button>
      </div>

      {/* 顶部核心数据卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">注册用户</p>
            <p className="text-3xl font-bold mt-1">{stats.totalUsers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">视频任务总数</p>
            <p className="text-3xl font-bold mt-1">{stats.totalJobs}</p>
            <p className="text-xs text-muted-foreground mt-1">成功率 {stats.successRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">已完成 / 失败</p>
            <p className="text-3xl font-bold mt-1">
              <span className="text-green-600">{stats.completedJobs}</span>
              <span className="text-muted-foreground text-xl"> / </span>
              <span className="text-red-500">{stats.failedJobs}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">提示词 / 策略</p>
            <p className="text-3xl font-bold mt-1">{stats.totalPrompts}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats.totalStrategies} 个策略</p>
          </CardContent>
        </Card>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 mb-4 border-b">
        {(["overview", "users", "jobs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "overview" ? "总览" : tab === "users" ? `用户 (${stats.totalUsers})` : `任务记录 (${stats.totalJobs})`}
          </button>
        ))}
      </div>

      {/* 总览 Tab */}
      {activeTab === "overview" && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">任务状态分布</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "已完成", value: stats.completedJobs, color: "bg-green-500" },
                { label: "失败", value: stats.failedJobs, color: "bg-red-500" },
                { label: "排队/进行中", value: stats.processingJobs, color: "bg-yellow-500" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${item.color} rounded-full`}
                      style={{ width: stats.totalJobs > 0 ? `${(item.value / stats.totalJobs) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">最近 5 个任务</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{job.brandName} · {job.direction}</p>
                    <p className="text-xs text-muted-foreground">{job.merchantEmail}</p>
                  </div>
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[job.status] || ""}`}>
                    {STATUS_LABEL[job.status] || job.status}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 用户 Tab */}
      {activeTab === "users" && (
        <div className="space-y-3">
          {users.length === 0 && (
            <p className="text-muted-foreground text-sm py-8 text-center">暂无用户</p>
          )}
          {users.map((user) => (
            <Card key={user.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      注册于 {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                    </p>
                    <p className="text-xs mt-0.5">
                      {user.lastLoginAt ? (
                        <span className="text-green-600">
                          最近登录：{new Date(user.lastLoginAt).toLocaleString("zh-CN")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">从未登录</span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <Badge variant="outline" className="text-xs">{user.profiles} 个品牌画像</Badge>
                    <Badge variant="outline" className="text-xs">{user.strategies} 个策略</Badge>
                    <Badge variant="outline" className="text-xs">{user.prompts} 条提示词</Badge>
                  </div>
                </div>
                {user.videos > 0 && (
                  <div className="mt-3 pt-3 border-t flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">视频任务：</span>
                    <span className="text-green-600 font-medium">✓ {user.videosCompleted} 完成</span>
                    {user.videosFailed > 0 && (
                      <span className="text-red-500 font-medium">✗ {user.videosFailed} 失败</span>
                    )}
                    <span className="text-muted-foreground">共 {user.videos} 个</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 任务记录 Tab */}
      {activeTab === "jobs" && (
        <div className="space-y-2">
          {recentJobs.length === 0 && (
            <p className="text-muted-foreground text-sm py-8 text-center">暂无任务记录</p>
          )}
          {recentJobs.map((job) => (
            <Card key={job.id}>
              <CardContent className="py-3">
                <div className="flex items-start gap-3">
                  <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${STATUS_COLOR[job.status] || ""}`}>
                    {STATUS_LABEL[job.status] || job.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{job.brandName}</span>
                      <Badge variant="secondary" className="text-xs">{job.direction}</Badge>
                      <Badge variant="outline" className="text-xs">{job.style}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto">{job.merchantEmail}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{job.contentPreview}...</p>
                    {job.errorMessage && (
                      <p className="text-xs text-red-500 mt-1 truncate">{job.errorMessage}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString("zh-CN")}
                      </span>
                      {job.resultUrl && (
                        <a
                          href={job.resultUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          查看视频
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
