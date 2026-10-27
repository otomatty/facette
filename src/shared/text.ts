/** 検索用の正規化: 全角英数→半角、カタカナ→ひらがな、空白除去、小文字化 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function fullName(m: { lastName: string; firstName: string }): string {
  return `${m.lastName} ${m.firstName}`;
}

export function fullKana(m: { lastNameKana: string; firstNameKana: string }): string {
  return `${m.lastNameKana} ${m.firstNameKana}`.trim();
}
