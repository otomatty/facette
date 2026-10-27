import { describe, expect, it } from "vitest";
import type { Department } from "../../shared/types";
import { buildDeptTree, descendantIds, flattenDeptTree } from "./queries";

const d = (id: number, parentId: number | null, sortOrder = id): Department => ({
  id,
  code: null,
  name: `部署${id}`,
  parentId,
  sortOrder,
  memberCount: 0,
});

describe("部署ツリー", () => {
  it("親子関係と並び順・深さを組み立てる", () => {
    const roots = buildDeptTree([d(3, 1, 2), d(1, null), d(2, 1, 1), d(4, 3)]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.children.map((c) => c.id)).toEqual([2, 3]);
    const flat = flattenDeptTree(roots);
    expect(flat.map((n) => [n.id, n.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
    expect(descendantIds(roots[0]!.children[1]!)).toEqual([3, 4]);
  });

  it("親が見つからない部署は最上位として扱う", () => {
    const roots = buildDeptTree([d(5, 99)]);
    expect(roots.map((r) => r.id)).toEqual([5]);
  });
});
