import { Building, FileSpreadsheet, Megaphone, Network, ScrollText, Sparkles, UserCog } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, NavLink, useParams } from "react-router";
import type { Capabilities } from "../../../shared/permissions";
import { cx, EmptyState, PageHeader } from "../../components/ui";
import { useAuth } from "../../lib/queries";
import { AnnouncementsTab } from "./AnnouncementsTab";
import { AuditTab } from "./AuditTab";
import { CompanyTab } from "./CompanyTab";
import { MastersTab } from "./MastersTab";
import { SheetsTab } from "./SheetsTab";
import { SkillsTab } from "./SkillsTab";
import { UsersTab } from "./UsersTab";

type TabKey = "users" | "sheets" | "masters" | "skills" | "announcements" | "audit" | "company";

const TABS: {
  key: TabKey;
  label: string;
  description: string;
  icon: ReactNode;
  cap: keyof Capabilities;
  render: () => ReactNode;
}[] = [
  {
    key: "users",
    label: "ユーザー",
    description: "ログインとロール",
    icon: <UserCog />,
    cap: "manageUsers",
    render: () => <UsersTab />,
  },
  {
    key: "sheets",
    label: "シート",
    description: "社員ごとの項目と権限",
    icon: <FileSpreadsheet />,
    cap: "manageSheets",
    render: () => <SheetsTab />,
  },
  {
    key: "masters",
    label: "組織・マスタ",
    description: "部署・役職・等級・雇用形態",
    icon: <Network />,
    cap: "manageMasters",
    render: () => <MastersTab />,
  },
  {
    key: "skills",
    label: "スキル",
    description: "スキルとカテゴリ",
    icon: <Sparkles />,
    cap: "manageTalent",
    render: () => <SkillsTab />,
  },
  {
    key: "announcements",
    label: "お知らせ",
    description: "ホームに表示する連絡",
    icon: <Megaphone />,
    cap: "manageAnnouncements",
    render: () => <AnnouncementsTab />,
  },
  {
    key: "audit",
    label: "操作ログ",
    description: "だれがいつ何をしたか",
    icon: <ScrollText />,
    cap: "viewAuditLogs",
    render: () => <AuditTab />,
  },
  {
    key: "company",
    label: "会社情報",
    description: "会社名",
    icon: <Building />,
    cap: "manageUsers",
    render: () => <CompanyTab />,
  },
];

export default function SettingsPage() {
  const me = useAuth();
  const { tab } = useParams();
  const available = TABS.filter((t) => me.capabilities[t.cap]);
  const first = available[0];

  if (!first) {
    return (
      <div>
        <PageHeader title="管理設定" />
        <div className="rounded-lg border border-line bg-white">
          <EmptyState title="管理設定を使う権限がありません">
            設定の変更が必要なときは、システム管理者か人事担当に依頼してください。
          </EmptyState>
        </div>
      </div>
    );
  }
  if (!tab) return <Navigate to={`/settings/${first.key}`} replace />;
  const current = available.find((t) => t.key === tab);
  if (!current) {
    // 存在しないタブや権限のないタブは、見られる最初のタブへ
    return <Navigate to={`/settings/${first.key}`} replace />;
  }

  return (
    <div>
      <PageHeader title="管理設定" description="Facette の利用者・データの項目・組織の情報を設定します。" />
      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        {/* 広い画面では左のメニュー、狭い画面では横に並ぶタブ */}
        <nav aria-label="設定メニュー" className="mb-5 lg:mb-0">
          <ul
            className={cx(
              "-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4",
              "lg:sticky lg:top-20 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-b-0 lg:px-0",
            )}
          >
            {available.map((t) => (
              <li key={t.key} className="shrink-0">
                <NavLink
                  to={`/settings/${t.key}`}
                  className={({ isActive }) =>
                    cx(
                      "flex items-center gap-2 text-sm whitespace-nowrap transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
                      // 狭い画面：下線のタブ
                      "-mb-px h-10 border-b-2 px-2.5",
                      // 広い画面：左のメニュー
                      "lg:mb-0 lg:h-auto lg:rounded-md lg:border-b-0 lg:px-2.5 lg:py-2",
                      isActive
                        ? "border-ai-700 font-bold text-ai-800 lg:bg-ai-100/70"
                        : "border-transparent text-ink-2 hover:text-ink lg:hover:bg-white",
                    )
                  }
                >
                  <span className="text-ai-600">{t.icon}</span>
                  <span className="min-w-0">
                    <span className="block">{t.label}</span>
                    <span className="hidden truncate text-[11px] font-normal text-ink-3 lg:block">
                      {t.description}
                    </span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">{current.render()}</div>
      </div>
    </div>
  );
}
