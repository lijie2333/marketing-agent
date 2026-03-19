export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">ADMIN</span>
          <span className="font-semibold text-sm">Marketing Agent 管理后台</span>
        </div>
        <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          ← 返回用户界面
        </a>
      </header>
      <main>{children}</main>
    </div>
  );
}
