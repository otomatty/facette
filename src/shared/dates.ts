/** "YYYY-MM-DD" 形式の日付から満年齢を求める */
export function ageOn(birthDate: string | null | undefined, today: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  if (!by || !ty) return null;
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

/** 勤続年数（小数第1位） */
export function tenureYears(hireDate: string | null | undefined, today: string): number | null {
  if (!hireDate || hireDate > today) return null;
  const [hy, hm, hd] = hireDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  if (!hy || !ty) return null;
  const months = (ty - hy) * 12 + (tm - hm) - (td < hd ? 1 : 0);
  return Math.floor((months / 12) * 10) / 10;
}

/** 日本時間の今日を "YYYY-MM-DD" で返す */
export function todayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function formatDateJa(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  if (!y || !m || !d) return s;
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export function formatDateTimeJa(s: string | null | undefined): string {
  if (!s) return "—";
  // DB の datetime('now') は UTC の "YYYY-MM-DD HH:MM:SS"
  const iso = s.includes("T") ? s : `${s.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}/${p(j.getUTCMonth() + 1)}/${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}
