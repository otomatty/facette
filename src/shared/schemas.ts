import { z } from "zod";
import { FIELD_TYPES, GENDERS, MEMBER_STATUSES } from "./constants";
import { isIsoDate } from "./dates";

const optionalDate = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : s))
  .nullable()
  .optional()
  .refine((s) => s === null || s === undefined || isIsoDate(s), "日付は YYYY-MM-DD 形式で入力してください");

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}は${max}文字以内で入力してください`)
    .nullable()
    .optional()
    .transform((s) => (s === "" ? null : s));

const optionalId = z.number().int().positive().nullable().optional();

export const memberInputSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(1, "社員番号を入力してください")
    .max(30, "社員番号は30文字以内で入力してください"),
  lastName: z.string().trim().min(1, "姓を入力してください").max(40),
  firstName: z.string().trim().min(1, "名を入力してください").max(40),
  lastNameKana: z.string().trim().max(60).default(""),
  firstNameKana: z.string().trim().max(60).default(""),
  email: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((s) => (s === "" ? null : s))
    .refine((s) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "メールアドレスの形式が正しくありません"),
  gender: z.enum(GENDERS).default("unknown"),
  birthDate: optionalDate,
  hireDate: optionalDate,
  leaveDate: optionalDate,
  status: z.enum(MEMBER_STATUSES).default("active"),
  departmentId: optionalId,
  jobTitleId: optionalId,
  gradeId: optionalId,
  employmentTypeId: optionalId,
  phone: optionalText(40, "電話番号"),
  workLocation: optionalText(60, "勤務地"),
  bio: z.string().max(1000, "自己紹介は1000文字以内で入力してください").default(""),
});
export type MemberInput = z.input<typeof memberInputSchema>;

/** 本人が編集できる基本情報 */
export const selfProfileSchema = z.object({
  bio: z.string().max(1000, "自己紹介は1000文字以内で入力してください").optional(),
  phone: optionalText(40, "電話番号"),
  workLocation: optionalText(60, "勤務地"),
});

export const sheetInputSchema = z.object({
  name: z.string().trim().min(1, "シート名を入力してください").max(60),
  description: z.string().trim().max(400).default(""),
  kind: z.enum(["single", "multi"]),
  selfAccess: z.enum(["none", "view", "edit"]),
  permissions: z.object({
    hr: z.enum(["none", "view", "edit"]),
    manager: z.enum(["none", "view", "edit"]),
    member: z.enum(["none", "view", "edit"]),
  }),
});

export const sheetFieldInputSchema = z
  .object({
    label: z.string().trim().min(1, "項目名を入力してください").max(60),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
    required: z.boolean().default(false),
    helpText: z.string().trim().max(200).default(""),
  })
  .refine((f) => !(f.type === "select" || f.type === "multiselect") || f.options.length > 0, {
    message: "選択肢を1つ以上入力してください",
    path: ["options"],
  });

export const departmentInputSchema = z.object({
  name: z.string().trim().min(1, "部署名を入力してください").max(60),
  code: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .optional()
    .transform((s) => (s === "" ? null : s)),
  parentId: z.number().int().positive().nullable(),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, "メールアドレスを入力してください"),
  password: z.string().min(1, "パスワードを入力してください"),
});
