import type { AccessLevel, Role } from "./constants";

export type Capabilities = {
  /** 社員の追加・基本情報の編集・CSV入出力 */
  manageMembers: boolean;
  /** 部署・役職・等級などのマスタ管理 */
  manageMasters: boolean;
  /** シート（カスタム項目）の設計 */
  manageSheets: boolean;
  /** ログインユーザーとロールの管理 */
  manageUsers: boolean;
  /** 操作ログの閲覧 */
  viewAuditLogs: boolean;
  /** 評価制度・評価期間の運用 */
  manageEvaluations: boolean;
  /** アンケートの作成・配信・集計 */
  manageSurveys: boolean;
  /** 配置シミュレーションの作成 */
  usePlacement: boolean;
  /** 配置シミュレーションの本番反映 */
  applyPlacement: boolean;
  /** 分析・ダッシュボード */
  viewAnalytics: boolean;
  /** お知らせの投稿 */
  manageAnnouncements: boolean;
  /** スキル・ポジションのマスタ管理 */
  manageTalent: boolean;
  /** 申請の承認 */
  reviewRequests: boolean;
  /** 1on1 記録の作成 */
  writeOneOnOnes: boolean;
};

export function capabilitiesFor(role: Role): Capabilities {
  const admin = role === "admin";
  const hr = role === "hr";
  const manager = role === "manager";
  const staff = admin || hr;
  return {
    manageMembers: staff,
    manageMasters: staff,
    manageSheets: admin,
    manageUsers: admin,
    viewAuditLogs: admin,
    manageEvaluations: staff,
    manageSurveys: staff,
    usePlacement: staff || manager,
    applyPlacement: staff,
    viewAnalytics: staff || manager,
    manageAnnouncements: staff,
    manageTalent: staff,
    reviewRequests: staff,
    writeOneOnOnes: staff || manager,
  };
}

export type SheetAccessInput = {
  role: Role;
  /** ロール別のアクセス設定（admin は常に編集可） */
  roleAccess: Partial<Record<Exclude<Role, "admin">, AccessLevel>>;
  /** 本人に対するアクセス */
  selfAccess: AccessLevel;
  /** 対象社員が本人か */
  isSelf: boolean;
  /** 対象社員が閲覧者の管轄範囲（admin/hr は全社、manager は自部署配下）か */
  inScope: boolean;
};

const ORDER: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export function maxAccess(a: AccessLevel, b: AccessLevel): AccessLevel {
  return ORDER[a] >= ORDER[b] ? a : b;
}

/**
 * シートに対する実効アクセス権を求める。
 * - admin は常に edit
 * - 「一般社員」ロールの設定は全社公開の範囲として扱い、他人に対しては閲覧までに制限
 * - 人事は全社員に人事ロールの設定を適用（本人を除く）
 * - マネージャーは管轄範囲（自部署配下）の社員にのみマネージャーロールの設定を適用（本人を除く）
 * - 本人に対しては全社公開の範囲と self_access の強い方。人事やマネージャーでも、
 *   自分自身の評価など本人に非公開のシートは見られない
 */
export function resolveSheetAccess(input: SheetAccessInput): AccessLevel {
  if (input.role === "admin") return "edit";
  const publicLevel: AccessLevel = (input.roleAccess.member ?? "none") === "none" ? "none" : "view";
  let level: AccessLevel = publicLevel;
  if (input.role === "hr" && !input.isSelf) {
    level = maxAccess(level, input.roleAccess.hr ?? "none");
  } else if (input.role === "manager" && input.inScope && !input.isSelf) {
    level = maxAccess(level, input.roleAccess.manager ?? "none");
  }
  if (input.isSelf) level = maxAccess(level, input.selfAccess);
  return level;
}

/** 生年月日・性別・等級など機微な基本情報を閲覧できるか */
export function canViewSensitive(role: Role, isSelf: boolean, inScope: boolean): boolean {
  if (role === "admin" || role === "hr") return true;
  if (isSelf) return true;
  return role === "manager" && inScope;
}
