import { describe, expect, it } from "vitest";
import { avatarDataUrl, avatarParts, avatarSvg } from "./avatar";

describe("イラストアバター", () => {
  it("同じシードからは同じ絵ができる", () => {
    expect(avatarSvg(12345)).toBe(avatarSvg(12345));
    expect(avatarSvg(12345)).not.toBe(avatarSvg(12346));
  });

  it("シードの最下位ビットで髪型の系統が決まる", () => {
    expect(avatarParts(1000).long).toBe(false);
    expect(avatarParts(1001).long).toBe(true);
  });

  it("SVG として妥当で、データ URL にできる", () => {
    const svg = avatarSvg(42);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(avatarDataUrl(42)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });
});
