export const ROLES = ["admin", "hr", "manager", "member"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "システム管理者",
  hr: "人事担当",
  manager: "マネージャー",
  member: "一般社員",
};

export const MEMBER_STATUSES = ["active", "leave", "retired"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: "在籍",
  leave: "休職",
  retired: "退職",
};

export const GENDERS = ["male", "female", "other", "unknown"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  unknown: "未回答",
};

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "url",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "テキスト（1行）",
  textarea: "テキスト（複数行）",
  number: "数値",
  date: "日付",
  select: "選択（1つ）",
  multiselect: "選択（複数）",
  checkbox: "チェック",
  url: "URL",
};

export const ACCESS_LEVELS = ["none", "view", "edit"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const ACCESS_LABELS: Record<AccessLevel, string> = {
  none: "非表示",
  view: "閲覧",
  edit: "編集",
};

export const EVAL_STEPS = ["goal", "self", "first", "second", "final", "done"] as const;
export type EvalStep = (typeof EVAL_STEPS)[number];
export const EVAL_STEP_LABELS: Record<EvalStep, string> = {
  goal: "目標設定",
  self: "自己評価",
  first: "一次評価",
  second: "二次評価",
  final: "最終確定",
  done: "完了",
};
export const EVAL_PHASES = ["self", "first", "second", "final"] as const;
export type EvalPhase = (typeof EVAL_PHASES)[number];

export const EVAL_PERIOD_STATUS_LABELS = {
  draft: "準備中",
  active: "実施中",
  closed: "終了",
} as const;

export const SURVEY_QUESTION_TYPES = ["single", "multi", "scale", "nps", "text"] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];
export const SURVEY_QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  single: "単一選択",
  multi: "複数選択",
  scale: "5段階評価",
  nps: "推奨度（0〜10）",
  text: "自由記述",
};
export const SURVEY_STATUS_LABELS = {
  draft: "下書き",
  open: "回答受付中",
  closed: "締切",
} as const;

export const SKILL_LEVEL_LABELS: Record<number, string> = {
  1: "学習中",
  2: "補助があればできる",
  3: "一人でできる",
  4: "指導できる",
  5: "第一人者",
};

export const CONDITION_LABELS: Record<number, string> = {
  1: "とても悪い",
  2: "悪い",
  3: "ふつう",
  4: "良い",
  5: "とても良い",
};

export const CHANGE_REQUEST_STATUS_LABELS = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取り下げ",
} as const;

export const DEFAULT_RANK_RULES = [
  { rank: "S", min: 4.5 },
  { rank: "A", min: 3.75 },
  { rank: "B", min: 2.75 },
  { rank: "C", min: 1.75 },
  { rank: "D", min: 0 },
];
