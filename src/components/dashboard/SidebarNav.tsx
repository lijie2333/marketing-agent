"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  User,
  TrendingUp,
  FileText,
  Layers,
  Video,
  LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/onboarding", label: "品牌入驻", icon: Sparkles },
  { href: "/profile", label: "品牌画像", icon: User },
  { href: "/strategy", label: "视频策略", icon: TrendingUp },
  { href: "/prompts", label: "提示词管理", icon: FileText },
  { href: "/jobs", label: "生产任务", icon: Layers },
  { href: "/library", label: "视频库", icon: Video },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 p-3 space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group ${
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <Icon
              className={`w-4 h-4 shrink-0 transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-accent-foreground"
              }`}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function LogoutButton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground">
      <LogOut className="w-4 h-4 shrink-0" />
      退出登录
    </div>
  );
}
