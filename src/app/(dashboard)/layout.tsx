import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/onboarding", label: "品牌入驻" },
  { href: "/profile", label: "品牌画像" },
  { href: "/strategy", label: "视频策略" },
  { href: "/prompts", label: "提示词管理" },
  { href: "/jobs", label: "生产任务" },
  { href: "/library", label: "视频库" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <h1 className="font-bold text-sm">Marketing Agent</h1>
          <p className="text-xs text-muted-foreground truncate">{session.user?.email}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-3 py-2 rounded text-sm hover:bg-accent transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t">
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              退出登录
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
