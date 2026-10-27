import { describe, expect, it } from "vitest";
import { canViewSensitive, capabilitiesFor, resolveSheetAccess } from "./permissions";

const sheet = {
  roleAccess: { hr: "edit", manager: "edit", member: "none" } as const,
  selfAccess: "view" as const,
};

describe("シートの実効権限", () => {
  it("管理者は常に編集可", () => {
    expect(resolveSheetAccess({ ...sheet, role: "admin", isSelf: false, inScope: false })).toBe("edit");
  });
  it("マネージャーは管轄内のみロール権限が適用され、本人には適用されない", () => {
    expect(resolveSheetAccess({ ...sheet, role: "manager", isSelf: false, inScope: true })).toBe("edit");
    expect(resolveSheetAccess({ ...sheet, role: "manager", isSelf: false, inScope: false })).toBe("none");
    expect(resolveSheetAccess({ ...sheet, role: "manager", isSelf: true, inScope: true })).toBe("view");
    // 人事でも自分自身には人事ロールの設定を使わない
    expect(resolveSheetAccess({ ...sheet, role: "hr", isSelf: false, inScope: true })).toBe("edit");
    expect(resolveSheetAccess({ ...sheet, role: "hr", isSelf: true, inScope: true })).toBe("view");
    expect(
      resolveSheetAccess({ ...sheet, selfAccess: "none", role: "hr", isSelf: true, inScope: true }),
    ).toBe("none");
  });
  it("全社公開（一般社員=編集）でも他人に対しては閲覧まで", () => {
    const pub = {
      roleAccess: { hr: "edit", manager: "view", member: "edit" } as const,
      selfAccess: "edit" as const,
    };
    expect(resolveSheetAccess({ ...pub, role: "member", isSelf: false, inScope: false })).toBe("view");
    expect(resolveSheetAccess({ ...pub, role: "member", isSelf: true, inScope: true })).toBe("edit");
  });
  it("一般社員は非公開シートを本人分のみ self_access で見られる", () => {
    expect(resolveSheetAccess({ ...sheet, role: "member", isSelf: false, inScope: false })).toBe("none");
    expect(resolveSheetAccess({ ...sheet, role: "member", isSelf: true, inScope: true })).toBe("view");
  });
});

describe("ロール別の機能", () => {
  it("システム管理だけが管理者専用", () => {
    expect(capabilitiesFor("admin").manageUsers).toBe(true);
    expect(capabilitiesFor("hr").manageUsers).toBe(false);
    expect(capabilitiesFor("hr").manageEvaluations).toBe(true);
    expect(capabilitiesFor("manager").usePlacement).toBe(true);
    expect(capabilitiesFor("manager").applyPlacement).toBe(false);
    expect(capabilitiesFor("member").viewAnalytics).toBe(false);
  });
  it("機微情報は人事・本人・管轄内マネージャーのみ", () => {
    expect(canViewSensitive("member", false, false)).toBe(false);
    expect(canViewSensitive("member", true, true)).toBe(true);
    expect(canViewSensitive("manager", false, true)).toBe(true);
    expect(canViewSensitive("manager", false, false)).toBe(false);
    expect(canViewSensitive("hr", false, false)).toBe(true);
  });
});
