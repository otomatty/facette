import { QueryClient, useQuery } from "@tanstack/react-query";
import type { Department, Masters, MemberSummary, MeResponse, Paged, Sheet, Skill } from "../../shared/types";
import { ApiError, get } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => get<MeResponse>("/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** ログイン済みである前提で me を返す（AppShell 配下で使う） */
export function useAuth(): MeResponse {
  const { data } = useMe();
  if (!data) throw new Error("useAuth はログイン後の画面でのみ使えます");
  return data;
}

export function useMasters() {
  return useQuery({ queryKey: ["masters"], queryFn: () => get<Masters>("/masters"), staleTime: 5 * 60_000 });
}

export function useSheets() {
  return useQuery({
    queryKey: ["sheets"],
    queryFn: async () => (await get<{ items: Sheet[] }>("/sheets")).items,
    staleTime: 5 * 60_000,
  });
}

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: async () => (await get<{ items: Skill[] }>("/skills")).items,
    staleTime: 5 * 60_000,
  });
}

/** 組織図・配置などで使う全社員（在籍・休職） */
export function useAllMembers() {
  return useQuery({
    queryKey: ["members", "all"],
    queryFn: async () => (await get<Paged<MemberSummary>>("/members?pageSize=2000&sort=department")).items,
    staleTime: 60_000,
  });
}

export type DeptNode = Department & { children: DeptNode[]; depth: number };

export function buildDeptTree(departments: Department[]): DeptNode[] {
  const nodes = new Map<number, DeptNode>();
  for (const d of departments) nodes.set(d.id, { ...d, children: [], depth: 0 });
  const roots: DeptNode[] = [];
  for (const d of departments) {
    const node = nodes.get(d.id)!;
    const parent = d.parentId !== null ? nodes.get(d.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setDepth = (list: DeptNode[], depth: number) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    for (const n of list) {
      n.depth = depth;
      setDepth(n.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  return roots;
}

/** ツリーを深さ優先で平坦化（インデント付きの選択肢などに使う） */
export function flattenDeptTree(roots: DeptNode[]): DeptNode[] {
  const out: DeptNode[] = [];
  const walk = (list: DeptNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

export function descendantIds(node: DeptNode): number[] {
  const out = [node.id];
  for (const ch of node.children) out.push(...descendantIds(ch));
  return out;
}
