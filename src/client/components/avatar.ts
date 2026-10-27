/**
 * 顔写真が未登録の社員に表示するイラストのアバターを、シード値から決定的に生成する。
 * シードの最下位ビットで髪型の系統（短い/長い）を切り替える。
 */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BACKGROUNDS = ["#dfe8f3", "#e3efe7", "#f3eadb", "#ebe4f2", "#f4e1e1", "#e0eef0", "#eceae2", "#e6e9f6"];
const SKINS = ["#f6d7c0", "#eec5a6", "#e2b08c", "#c98f68", "#a8714f", "#f3dccb"];
const HAIRS = ["#2b2523", "#3b2c25", "#4d3527", "#1f2430", "#6b4a33", "#8a8580", "#b9b4ae", "#5a3d2e"];
const CLOTHES = ["#24476e", "#3b4a5c", "#5d6b7a", "#2f6b5a", "#7a5c3e", "#8b3f45", "#e9edf2", "#4f5d8a"];

export type AvatarParts = {
  bg: string;
  skin: string;
  hair: string;
  cloth: string;
  hairStyle: number;
  long: boolean;
  glasses: number;
  blush: boolean;
  eyes: number;
  collar: number;
};

export function avatarParts(seed: number): AvatarParts {
  const r = rng(seed);
  const long = (seed & 1) === 1;
  const greyChance = r();
  let hair = HAIRS[Math.floor(r() * 5)]!;
  if (greyChance > 0.9) hair = HAIRS[5 + Math.floor(r() * 2)]!;
  return {
    bg: BACKGROUNDS[Math.floor(r() * BACKGROUNDS.length)]!,
    skin: SKINS[Math.floor(r() * SKINS.length)]!,
    hair,
    cloth: CLOTHES[Math.floor(r() * CLOTHES.length)]!,
    hairStyle: Math.floor(r() * 4),
    long,
    glasses: r() < 0.22 ? (r() < 0.5 ? 1 : 2) : 0,
    blush: r() < 0.35,
    eyes: Math.floor(r() * 3),
    collar: Math.floor(r() * 3),
  };
}

function hairBack(p: AvatarParts): string {
  if (!p.long) return "";
  switch (p.hairStyle) {
    case 0: // ロング
      return `<path d="M15 30c0-12 7.5-20 17-20s17 8 17 20v22c0 3-2 5-5 5H20c-3 0-5-2-5-5z" fill="${p.hair}"/>`;
    case 1: // ボブ
      return `<path d="M16 30c0-11 7-19 16-19s16 8 16 19v12c0 3-2 5-5 5H21c-3 0-5-2-5-5z" fill="${p.hair}"/>`;
    case 2: // ひとつ結び（後ろ）
      return `<circle cx="32" cy="12" r="6.5" fill="${p.hair}"/>`;
    default: // セミロング
      return `<path d="M15.5 30c0-11.5 7.4-19.5 16.5-19.5S48.5 18.5 48.5 30v16c0 3-2 5-5 5h-23c-3 0-5-2-5-5z" fill="${p.hair}"/>`;
  }
}

function hairFront(p: AvatarParts): string {
  const h = p.hair;
  if (p.long) {
    switch (p.hairStyle) {
      case 0:
        return `<path d="M18.5 27c1-9 6.5-14.5 13.5-14.5S44.5 18 45.5 27c-5-1-9.5-4-12.5-8.5-2.5 4.5-8 7.5-14.5 8.5z" fill="${h}"/>`;
      case 1:
        return `<path d="M18 28c0-9.5 6-15.5 14-15.5S46 18.5 46 28c-8 0-18-1.5-28 0z" fill="${h}"/>`;
      case 2:
        return `<path d="M18.5 27.5c.5-9 6.5-15 13.5-15s13 6 13.5 15c-3-4.5-8-7-13.5-7s-10.5 2.5-13.5 7z" fill="${h}"/>`;
      default:
        return `<path d="M18.5 28c.5-9.5 6.5-15.5 13.5-15.5S45 18.5 45.5 28c-2.5-3-5-5-7.5-6-3 2.5-8.5 4-19.5 6z" fill="${h}"/>`;
    }
  }
  switch (p.hairStyle) {
    case 0: // 短髪
      return `<path d="M18.5 27c-.5-9 5.5-15 13.5-15s14 5.5 13.5 14.5c-1-2.5-2.5-4.5-4.5-5.5-4 1.5-11.5 1.5-17-.5-3 1.5-4.5 4-5.5 6.5z" fill="${h}"/>`;
    case 1: // 七三
      return `<path d="M18.5 28c-1-10 5.5-16 13.5-16s14 5 13.5 15c-.5-2.5-2-5-4-6-6 .5-13-1-16-4-3 2.5-5.5 6-7 11z" fill="${h}"/>`;
    case 2: // 坊主
      return `<path d="M19.5 25c1-7.5 6-12 12.5-12s11.5 4.5 12.5 12c-4-2.5-8-3.5-12.5-3.5S23.5 22.5 19.5 25z" fill="${h}" opacity=".9"/>`;
    default: // くせ毛
      return `<g fill="${h}"><circle cx="21" cy="22" r="4.5"/><circle cx="26" cy="17" r="5"/><circle cx="32" cy="15.5" r="5.2"/><circle cx="38" cy="17" r="5"/><circle cx="43" cy="22" r="4.5"/><circle cx="19.5" cy="27" r="2.6"/><circle cx="44.5" cy="27" r="2.6"/></g>`;
  }
}

function eyes(p: AvatarParts): string {
  const c = "#2a2a2e";
  switch (p.eyes) {
    case 0:
      return `<ellipse cx="27" cy="31" rx="1.4" ry="1.7" fill="${c}"/><ellipse cx="37" cy="31" rx="1.4" ry="1.7" fill="${c}"/>`;
    case 1:
      return `<path d="M25.3 31.4q1.7-1.8 3.4 0M35.3 31.4q1.7-1.8 3.4 0" stroke="${c}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;
    default:
      return `<circle cx="27" cy="31" r="1.5" fill="${c}"/><circle cx="37" cy="31" r="1.5" fill="${c}"/>`;
  }
}

function glasses(p: AvatarParts): string {
  if (!p.glasses) return "";
  const s = `stroke="#2f3640" stroke-width="1.1" fill="none"`;
  if (p.glasses === 1)
    return `<g ${s}><circle cx="27" cy="31" r="3.6"/><circle cx="37" cy="31" r="3.6"/><path d="M30.6 31h2.8"/></g>`;
  return `<g ${s}><rect x="22.8" y="28" width="8.2" height="6" rx="1.6"/><rect x="33" y="28" width="8.2" height="6" rx="1.6"/><path d="M31 30.5h2"/></g>`;
}

function collar(p: AvatarParts): string {
  const light = p.cloth === "#e9edf2";
  const shirt = light ? "#c9d1db" : "#f4f6f8";
  switch (p.collar) {
    case 0:
      return `<path d="M27 47l5 6 5-6" fill="${shirt}"/>`;
    case 1:
      return `<path d="M26.5 46.5l5.5 5 5.5-5-1-1.5h-9z" fill="${shirt}"/><path d="M32 51.5v12" stroke="${light ? "#9aa5b3" : "#d8dee6"}" stroke-width="1"/>`;
    default:
      return "";
  }
}

export function avatarSvg(seed: number): string {
  const p = avatarParts(seed);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="7 7 50 50">`,
    `<rect width="64" height="64" fill="${p.bg}"/>`,
    hairBack(p),
    `<path d="M10 64c1.5-10 9-16.5 22-16.5S52.5 54 54 64z" fill="${p.cloth}"/>`,
    `<path d="M28 41h8v7.5c-1.2 1.4-2.6 2-4 2s-2.8-.6-4-2z" fill="${p.skin}" />`,
    `<path d="M28 44.5c2.6 1.2 5.4 1.2 8 0V42h-8z" fill="#000" opacity=".08"/>`,
    collar(p),
    `<ellipse cx="18.6" cy="32" rx="2.4" ry="3.2" fill="${p.skin}"/>`,
    `<ellipse cx="45.4" cy="32" rx="2.4" ry="3.2" fill="${p.skin}"/>`,
    `<ellipse cx="32" cy="30.5" rx="13.2" ry="14.2" fill="${p.skin}"/>`,
    hairFront(p),
    `<path d="M24.6 27.2h4.4M35 27.2h4.4" stroke="${p.hair === "#b9b4ae" ? "#8d8781" : "#3a302b"}" stroke-width="1.2" stroke-linecap="round" opacity=".75"/>`,
    eyes(p),
    p.blush
      ? `<circle cx="23.8" cy="35.6" r="2.2" fill="#e98b86" opacity=".28"/><circle cx="40.2" cy="35.6" r="2.2" fill="#e98b86" opacity=".28"/>`
      : "",
    `<path d="M29 37.6q3 2.4 6 0" stroke="#9b5546" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
    glasses(p),
    `</svg>`,
  ].join("");
}

const cache = new Map<number, string>();
export function avatarDataUrl(seed: number): string {
  let url = cache.get(seed);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(seed))}`;
    cache.set(seed, url);
  }
  return url;
}
