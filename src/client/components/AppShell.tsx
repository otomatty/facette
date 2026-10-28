import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CircleUser,
  ClipboardCheck,
  Grid3x3,
  Home,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquareText,
  MessagesSquare,
  Network,
  Search,
  Settings,
  Shapes,
  Shuffle,
  Sparkles,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ROLE_LABELS } from "../../shared/constants";
import type { Capabilities } from "../../shared/permissions";
import type { MemberSummary, Paged } from "../../shared/types";
import { get, post, qs } from "../lib/api";
import { queryClient, useAuth } from "../lib/queries";
import { Face } from "./Face";
import { cx } from "./ui";

type NavItem = { to: string; label: string; icon: ReactNode; cap?: keyof Capabilities; end?: boolean };
const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [{ to: "/", label: "ホーム", icon: <Home />, end: true }],
  },
  {
    group: "人材",
    items: [
      { to: "/members", label: "メンバー", icon: <Users /> },
      { to: "/org", label: "組織ツリー", icon: <Network /> },
      { to: "/lists", label: "社員リスト", icon: <ListChecks /> },
      { to: "/skills", label: "スキル", icon: <Sparkles /> },
      { to: "/positions", label: "ポジション", icon: <Target /> },
    ],
  },
  {
    group: "配置",
    items: [
      { to: "/placement", label: "配置シミュレーション", icon: <Shuffle />, cap: "usePlacement" },
      { to: "/balance", label: "配置バランス図", icon: <Grid3x3 />, cap: "viewAnalytics" },
      { to: "/boards", label: "チームキャンバス", icon: <Shapes /> },
    ],
  },
  {
    group: "運用",
    items: [
      { to: "/evaluations", label: "評価", icon: <ClipboardCheck /> },
      { to: "/surveys", label: "アンケート", icon: <MessageSquareText /> },
      { to: "/one-on-ones", label: "1on1・面談", icon: <MessagesSquare /> },
      { to: "/requests", label: "申請", icon: <Inbox /> },
    ],
  },
  {
    group: "分析",
    items: [
      { to: "/dashboard", label: "ダッシュボード", icon: <LayoutDashboard />, cap: "viewAnalytics" },
      { to: "/analytics", label: "社員データグラフ", icon: <BarChart3 />, cap: "viewAnalytics" },
    ],
  },
];

export function BrandMark({ className }: { className?: string }) {
  // 多面体のカット面をモチーフにしたマーク
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M16 2 29 10v12L16 30 3 22V10z" fill="#3e6a9c" />
      <path d="M16 2 29 10 16 15 3 10z" fill="#9db6d3" />
      <path d="M16 15 29 10v12L16 30z" fill="#24476e" />
      <path d="M16 15v15L3 22V10z" fill="#2f5a8a" />
      <circle cx="16" cy="15" r="3.2" fill="#f2b134" />
    </svg>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const me = useAuth();
  const canSettings =
    me.capabilities.manageMasters ||
    me.capabilities.manageSheets ||
    me.capabilities.manageUsers ||
    me.capabilities.manageAnnouncements;
  return (
    <nav aria-label="メインメニュー" className="flex h-full flex-col bg-ai-900 text-ai-100">
      <Link to="/" className="flex items-center gap-2.5 px-5 pt-5 pb-4" onClick={onNavigate}>
        <BrandMark className="size-8" />
        <div className="leading-tight">
          <div className="text-[17px] font-bold tracking-wide text-white">Facette</div>
          <div className="max-w-[150px] truncate text-[11px] text-ai-300">{me.companyName}</div>
        </div>
      </Link>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.cap || me.capabilities[i.cap]);
          if (!items.length) return null;
          return (
            <div key={g.group ?? "top"} className="mt-3 first:mt-0">
              {g.group && <div className="px-2 pb-1 text-[11px] text-ai-300/80">{g.group}</div>}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cx(
                          "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors [&_svg]:size-[18px]",
                          isActive
                            ? "bg-white/12 font-bold text-white shadow-[inset_3px_0_0_var(--color-yamabuki)]"
                            : "text-ai-100/85 hover:bg-white/6 hover:text-white",
                        )
                      }
                    >
                      {item.icon}
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {canSettings && (
        <div className="border-t border-white/10 px-3 py-3">
          <NavLink
            to="/settings"
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] [&_svg]:size-[18px]",
                isActive
                  ? "bg-white/12 font-bold text-white"
                  : "text-ai-100/85 hover:bg-white/6 hover:text-white",
              )
            }
          >
            <Settings />
            管理設定
          </NavLink>
        </div>
      )}
    </nav>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 200);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  const { data, isFetching } = useQuery({
    queryKey: ["quick-search", debounced],
    queryFn: () => get<Paged<MemberSummary>>(`/members${qs({ q: debounced, pageSize: 8 })}`),
    enabled: debounced.length > 0,
  });
  const items = debounced ? (data?.items ?? []) : [];
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        boxRef.current?.querySelector("input")?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const go = (m: MemberSummary) => {
    navigate(`/members/${m.id}`);
    setOpen(false);
    setQ("");
  };
  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      <input
        type="search"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls="global-search-results"
        aria-label="社員を検索"
        placeholder="社員を検索（氏名・かな・社員番号）"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            const m = items[active];
            if (m) go(m);
            else if (q.trim()) {
              navigate(`/members${qs({ q: q.trim() })}`);
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-9 w-full rounded-md border border-line bg-canvas pr-3 pl-9 text-sm placeholder:text-ink-3 focus:border-ai-500 focus:bg-white focus:ring-2 focus:ring-ai-100 focus:outline-none"
      />
      {open && debounced && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute top-11 right-0 left-0 z-50 overflow-hidden rounded-lg border border-line bg-white shadow-xl"
        >
          {items.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-3">
              {isFetching ? "検索しています" : "該当する社員がいません"}
            </div>
          ) : (
            items.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(m)}
                className={cx(
                  "flex w-full items-center gap-3 px-3 py-2 text-left",
                  i === active && "bg-ai-50",
                )}
              >
                <Face member={m} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {m.lastName} {m.firstName}
                    <span className="ml-2 text-xs font-normal text-ink-3">
                      {m.lastNameKana} {m.firstNameKana}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {m.departmentName ?? "所属なし"}
                    <span className="tabular ml-2">{m.employeeCode}</span>
                  </span>
                </span>
              </button>
            ))
          )}
          {data && data.total > items.length && (
            <Link
              to={`/members${qs({ q: debounced })}`}
              onClick={() => setOpen(false)}
              className="block border-t border-line-2 px-3 py-2 text-center text-xs font-bold text-ai-700 hover:bg-ai-50"
            >
              {data.total}件すべてを表示
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const me = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => post("/auth/sign-out"),
    onSettled: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md py-1 pr-2 pl-1 hover:bg-ai-50"
      >
        {me.member ? (
          <Face member={me.member} size={30} rounded="full" />
        ) : (
          <span className="flex size-[30px] items-center justify-center rounded-full bg-ai-100">
            <UserRound className="size-4 text-ai-700" />
          </span>
        )}
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[13px] font-bold">{me.user.displayName}</span>
          <span className="block text-[11px] text-ink-3">{ROLE_LABELS[me.user.role]}</span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-11 right-0 z-50 w-56 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-xl"
        >
          <div className="border-b border-line-2 px-3 py-2 text-xs text-ink-3">{me.user.email}</div>
          {me.member && (
            <Link
              role="menuitem"
              to={`/members/${me.member.id}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ai-50"
            >
              <UserRound className="size-4 text-ink-3" />
              自分のプロフィール
            </Link>
          )}
          <Link
            role="menuitem"
            to="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ai-50"
          >
            <CircleUser className="size-4 text-ink-3" />
            アカウント
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => logout.mutate()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ai-50"
          >
            <LogOut className="size-4 text-ink-3" />
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const wide = useMemo(
    () => /^\/(org|placement\/\d+|balance|boards\/\d+)/.test(location.pathname),
    [location.pathname],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: ページ遷移のたびに実行する
  useEffect(() => {
    setDrawer(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="メニューを閉じる"
            className="absolute inset-0 bg-ai-950/40"
            onClick={() => setDrawer(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar onNavigate={() => setDrawer(false)} />
            <button
              type="button"
              aria-label="メニューを閉じる"
              onClick={() => setDrawer(false)}
              className="absolute top-4 right-3 text-ai-100"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            aria-label="メニューを開く"
            className="-ml-1 rounded-md p-1.5 text-ink-2 hover:bg-ai-50 lg:hidden"
            onClick={() => setDrawer(true)}
          >
            <Menu className="size-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className={cx("w-full flex-1 px-4 py-6 lg:px-8", !wide && "mx-auto max-w-[1360px]")}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
