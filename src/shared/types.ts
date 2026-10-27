import type {
  AccessLevel,
  EvalStep,
  FieldType,
  Gender,
  MemberStatus,
  Role,
  SurveyQuestionType,
} from "./constants";
import type { Capabilities } from "./permissions";

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

// ───────── 認証 ─────────
export type MeResponse = {
  user: { id: number; email: string; displayName: string; role: Role; memberId: number | null };
  member: MemberSummary | null;
  capabilities: Capabilities;
  /** 管轄範囲の部署 ID（null は全社） */
  scopeDepartmentIds: number[] | null;
  companyName: string;
  demoMode: boolean;
};

export type DemoAccount = {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  memberId: number | null;
  avatarSeed: number | null;
  subtitle: string | null;
};

// ───────── マスタ ─────────
export type Department = {
  id: number;
  code: string | null;
  name: string;
  parentId: number | null;
  sortOrder: number;
  memberCount: number;
};
export type JobTitle = { id: number; name: string; rank: number; isManager: boolean };
export type Grade = { id: number; name: string; rank: number };
export type EmploymentType = { id: number; name: string; sortOrder: number };
export type Masters = {
  departments: Department[];
  jobTitles: JobTitle[];
  grades: Grade[];
  employmentTypes: EmploymentType[];
};

// ───────── 社員 ─────────
export type MemberSummary = {
  id: number;
  employeeCode: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  departmentId: number | null;
  departmentName: string | null;
  jobTitleId: number | null;
  jobTitleName: string | null;
  status: MemberStatus;
  hireDate: string | null;
  workLocation: string | null;
  photoUrl: string | null;
  avatarSeed: number;
  /** 機微情報。閲覧権限がない場合は null */
  gender: Gender | null;
  gradeId: number | null;
  gradeName: string | null;
  employmentTypeId: number | null;
  employmentTypeName: string | null;
  birthDate: string | null;
};

export type MemberDetail = MemberSummary & {
  email: string | null;
  phone: string | null;
  bio: string;
  leaveDate: string | null;
  /** 本人または管轄範囲内か（詳細情報が見えるか） */
  inScope: boolean;
  isSelf: boolean;
  canEditBasic: boolean;
  canEditPhoto: boolean;
  path: { id: number; name: string }[];
};

export type MemberTransfer = {
  id: number;
  effectiveDate: string;
  fromDepartmentName: string | null;
  toDepartmentName: string | null;
  fromJobTitleName: string | null;
  toJobTitleName: string | null;
  note: string;
};

export type MemberSearchParams = {
  q?: string;
  departmentId?: number;
  includeSub?: boolean;
  jobTitleId?: number;
  gradeId?: number;
  employmentTypeId?: number;
  status?: MemberStatus | "all";
  gender?: Gender;
  hiredFrom?: string;
  hiredTo?: string;
  skillId?: number;
  skillMin?: number;
  listId?: number;
  sort?: "kana" | "code" | "hire" | "department";
  page?: number;
  pageSize?: number;
};

// ───────── シート ─────────
export type SheetField = {
  id: number;
  sheetId: number;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
  helpText: string;
  sortOrder: number;
};

export type Sheet = {
  id: number;
  name: string;
  description: string;
  kind: "single" | "multi";
  sortOrder: number;
  selfAccess: AccessLevel;
  permissions: { hr: AccessLevel; manager: AccessLevel; member: AccessLevel };
  fields: SheetField[];
};

export type FieldValue = string | number | boolean | string[] | null;

export type SheetRecord = {
  id: number;
  sheetId: number;
  memberId: number;
  data: Record<string, FieldValue>;
  sortOrder: number;
  updatedAt: string;
};

export type MemberSheetView = {
  sheet: Sheet;
  access: AccessLevel;
  records: SheetRecord[];
  /** 本人が申請で変更できるか（閲覧のみ権限の本人向け） */
  canRequestChange: boolean;
};

// ───────── 社員リスト ─────────
export type MemberList = {
  id: number;
  name: string;
  description: string;
  color: string;
  shared: boolean;
  ownerUserId: number;
  ownerName: string;
  memberCount: number;
  isOwner: boolean;
  previewMembers: MemberSummary[];
};

// ───────── スキル・ポジション ─────────
export type Skill = { id: number; name: string; category: string; description: string; holderCount: number };
export type MemberSkill = { skillId: number; name: string; category: string; level: number };

export type JobPosition = {
  id: number;
  name: string;
  departmentId: number | null;
  departmentName: string | null;
  mission: string;
  description: string;
  headcount: number;
  status: "open" | "closed";
  requirements: { skillId: number; skillName: string; minLevel: number; weight: number }[];
};

export type PositionMatch = {
  member: MemberSummary;
  score: number;
  met: number;
  total: number;
  details: { skillId: number; skillName: string; required: number; actual: number }[];
};

// ───────── 1on1 ─────────
export type OneOnOne = {
  id: number;
  memberId: number;
  member: MemberSummary;
  interviewer: MemberSummary | null;
  heldOn: string;
  title: string;
  notes: string;
  nextActions: string;
  condition: number | null;
  sharedWithMember: boolean;
  canEdit: boolean;
  updatedAt: string;
};

// ───────── 評価 ─────────
export type EvaluationTemplate = {
  id: number;
  name: string;
  description: string;
  scaleMax: number;
  goalWeight: number;
  competencyWeight: number;
  rankRules: { rank: string; min: number }[];
  items: { id: number; title: string; description: string; weight: number; sortOrder: number }[];
  periodCount: number;
};

export type EvaluationPeriod = {
  id: number;
  name: string;
  templateId: number;
  templateName: string;
  startDate: string;
  endDate: string;
  status: "draft" | "active" | "closed";
  useSecondStep: boolean;
  sheetCount: number;
  doneCount: number;
  stepCounts: Partial<Record<EvalStep, number>>;
};

export type EvaluationSheetSummary = {
  id: number;
  periodId: number;
  periodName: string;
  periodStatus: "draft" | "active" | "closed";
  member: MemberSummary;
  firstEvaluator: MemberSummary | null;
  secondEvaluator: MemberSummary | null;
  step: EvalStep;
  finalScore: number | null;
  finalRank: string | null;
  /** 閲覧者が今アクションすべきか */
  myTurn: boolean;
  updatedAt: string;
};

export type EvaluationScoreEntry = { score: number | null; comment: string };

export type EvaluationSheetDetail = EvaluationSheetSummary & {
  template: EvaluationTemplate;
  useSecondStep: boolean;
  goals: { id: number; title: string; description: string; weight: number; sortOrder: number }[];
  /** phase -> "goal:ID" | "item:ID" -> entry */
  scores: Record<string, Record<string, EvaluationScoreEntry>>;
  phaseComments: Record<string, string>;
  phaseTotals: Record<string, number | null>;
  /** 閲覧可能なフェーズ */
  visiblePhases: string[];
  /** 編集可能なフェーズ（goal は目標編集） */
  editable: "goal" | "self" | "first" | "second" | "final" | null;
  canRemand: boolean;
  canReopen: boolean;
  events: {
    id: number;
    action: "submit" | "remand" | "reopen";
    fromStep: EvalStep;
    toStep: EvalStep;
    userName: string | null;
    comment: string;
    createdAt: string;
  }[];
};

// ───────── アンケート ─────────
export type SurveyQuestion = {
  id: number;
  type: SurveyQuestionType;
  text: string;
  options: string[];
  required: boolean;
  sortOrder: number;
};

export type Survey = {
  id: number;
  title: string;
  description: string;
  kind: "survey" | "pulse";
  anonymous: boolean;
  status: "draft" | "open" | "closed";
  closesAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  questions: SurveyQuestion[];
  targetCount: number;
  responseCount: number;
  /** 閲覧者本人が対象者か・回答済みか */
  isTarget: boolean;
  responded: boolean;
};

export type SurveyQuestionResult = {
  questionId: number;
  type: SurveyQuestionType;
  text: string;
  answered: number;
  counts?: { label: string; count: number }[];
  average?: number | null;
  nps?: { score: number; promoters: number; passives: number; detractors: number } | null;
  texts?: { text: string; respondent: string | null }[];
};

export type SurveyResults = {
  survey: Survey;
  questions: SurveyQuestionResult[];
  byDepartment: { departmentId: number | null; departmentName: string; targets: number; responses: number }[];
};

// ───────── 配置シミュレーション ─────────
export type PlacementScenario = {
  id: number;
  name: string;
  description: string;
  status: "draft" | "applied";
  effectiveDate: string | null;
  createdByName: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  moveCount: number;
};

export type PlacementMove = {
  memberId: number;
  toDepartmentId: number | null;
  toJobTitleId: number | null;
};

// ───────── お知らせ・申請・ログ ─────────
export type Announcement = {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  authorName: string | null;
};

export type ChangeRequest = {
  id: number;
  member: MemberSummary;
  requesterName: string | null;
  sheetId: number;
  sheetName: string;
  recordId: number | null;
  payload: Record<string, FieldValue>;
  before: Record<string, FieldValue> | null;
  fields: SheetField[];
  reason: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reviewerName: string | null;
  reviewComment: string;
  createdAt: string;
  reviewedAt: string | null;
};

export type AuditLog = {
  id: number;
  userName: string;
  action: string;
  targetType: string;
  targetId: number | null;
  summary: string;
  ip: string | null;
  createdAt: string;
};

export type AppUser = {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  memberId: number | null;
  member: MemberSummary | null;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

// ───────── 分析 ─────────
export type ChartDimension =
  | "department"
  | "division"
  | "jobTitle"
  | "grade"
  | "employmentType"
  | "gender"
  | "ageBand"
  | "tenureBand"
  | "hireYear"
  | "workLocation"
  | "status"
  | "evalRank"
  | `field:${number}`;

export type ChartConfig = {
  dimension: ChartDimension;
  /** 積み上げ・クロス集計に使う第2軸（任意） */
  series?: ChartDimension | null;
  type: "bar" | "column" | "donut" | "stacked";
  filters?: { departmentId?: number; includeSub?: boolean; status?: MemberStatus | "all" };
  evalPeriodId?: number | null;
};

export type ChartData = {
  labels: string[];
  series: { name: string; values: number[] }[];
  total: number;
};

export type SavedChart = {
  id: number;
  name: string;
  config: ChartConfig;
  shared: boolean;
  isOwner: boolean;
  ownerName: string;
  updatedAt: string;
};

export type MetricKey =
  | "headcount"
  | "averageAge"
  | "averageTenure"
  | "femaleRatio"
  | "femaleManagerRatio"
  | "managerRatio"
  | "turnoverRate"
  | "hiresThisYear"
  | "leaveCount"
  | "surveyResponseRate";

export type Metric = { key: MetricKey; label: string; value: number | null; unit: string; note: string };

export type DashboardPanel = {
  id: number;
  kind: "metric" | "chart";
  config: { metric?: MetricKey; chartId?: number; chart?: ChartConfig; title?: string };
  width: 1 | 2;
  sortOrder: number;
};

export type HomeSummary = {
  todos: { kind: "evaluation" | "survey" | "request"; title: string; detail: string; href: string }[];
  announcements: Announcement[];
  stats: { headcount: number; joinedThisMonth: number; departments: number; onLeave: number };
  newcomers: MemberSummary[];
  /** 今月が入社記念月のメンバー（勤続年数つき） */
  anniversaries: { member: MemberSummary; years: number }[];
};

// ───────── チームキャンバス ─────────
export type BoardItem = { memberId: number; x: number; y: number };
export type BoardGroup = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: "ai" | "yamabuki" | "wakaba" | "beni" | "fuji" | "neutral";
};
export type BoardNote = { id: string; text: string; x: number; y: number };
export type BoardData = { items: BoardItem[]; groups: BoardGroup[]; notes: BoardNote[] };

export type TeamBoardSummary = {
  id: number;
  name: string;
  description: string;
  shared: boolean;
  isOwner: boolean;
  ownerName: string;
  memberCount: number;
  groupCount: number;
  previewMembers: MemberSummary[];
  updatedAt: string;
};

export type TeamBoard = TeamBoardSummary & { data: BoardData; members: MemberSummary[] };
