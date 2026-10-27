import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ImageUp } from "lucide-react";
import { useMemo, useState } from "react";
import type { MemberSummary, Paged } from "../../../shared/types";
import { Face } from "../../components/Face";
import { Badge, Button, Modal, useToast } from "../../components/ui";
import { api, errorMessage, get } from "../../lib/api";
import { queryClient } from "../../lib/queries";
import { resizeImage } from "./photo";

type Row = {
  file: File;
  code: string;
  member: MemberSummary | null;
  status: "ready" | "done" | "error" | "skip";
  error?: string;
};

/** ファイル名（拡張子を除く）を社員番号として顔写真をまとめて登録する */
export function PhotoBulkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const members = useQuery({
    queryKey: ["members", "all-including-retired"],
    queryFn: async () => (await get<Paged<MemberSummary>>("/members?pageSize=2000&status=all")).items,
    enabled: open,
  });
  const byCode = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.employeeCode.toUpperCase(), m])),
    [members.data],
  );

  const pick = (files: FileList | null) => {
    if (!files) return;
    setRows(
      [...files]
        .filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name))
        .map((file) => {
          const code = file.name.replace(/\.[^.]+$/, "").trim();
          const member = byCode.get(code.toUpperCase()) ?? null;
          return { file, code, member, status: member ? "ready" : "skip" };
        }),
    );
    setProgress(0);
  };

  const run = async () => {
    setRunning(true);
    let done = 0;
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      const r = next[i]!;
      if (r.status !== "ready" || !r.member) continue;
      try {
        const blob = await resizeImage(r.file);
        await api(`/members/${r.member.id}/photo`, {
          method: "PUT",
          body: blob,
          headers: { "content-type": "image/jpeg" },
        });
        next[i] = { ...r, status: "done" };
        done++;
      } catch (e) {
        next[i] = { ...r, status: "error", error: errorMessage(e) };
      }
      setRows([...next]);
      setProgress(i + 1);
    }
    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["member"] });
    toast(`${done}名の顔写真を登録しました`);
  };

  const ready = rows.filter((r) => r.status === "ready").length;
  const finished = rows.length > 0 && !running && rows.every((r) => r.status !== "ready");

  return (
    <Modal
      open={open}
      onClose={() => !running && onClose()}
      title="顔写真をまとめて登録"
      size="lg"
      footer={
        finished ? (
          <Button variant="primary" onClick={onClose}>
            閉じる
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={running}>
              キャンセル
            </Button>
            <Button variant="primary" disabled={!ready} loading={running} onClick={run}>
              {ready}名分を登録
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-ink-2">
          ファイル名を社員番号にした画像（例：E01020.jpg）を選んでください。正方形に切り抜いて縮小してから登録し、すでにある写真は置き換えます。
        </p>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-ai-300 bg-ai-50 px-3 font-bold text-ai-800 hover:bg-ai-100">
          <ImageUp className="size-4" />
          画像ファイルを選ぶ（複数可）
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={running || members.isLoading}
            onChange={(e) => pick(e.target.files)}
          />
        </label>
        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="ai">対象 {rows.filter((r) => r.member).length}名</Badge>
              {rows.some((r) => !r.member) && (
                <Badge tone="yamabuki">社員番号が見つからない {rows.filter((r) => !r.member).length}件</Badge>
              )}
              {running && (
                <span className="tabular text-xs text-ink-2">
                  {progress} / {rows.length}
                </span>
              )}
            </div>
            <ul className="max-h-72 divide-y divide-line-2 overflow-y-auto rounded-md border border-line">
              {rows.map((r) => (
                <li key={r.file.name} className="flex items-center gap-3 px-3 py-2">
                  {r.member ? (
                    <Face member={r.member} size={32} />
                  ) : (
                    <span className="size-8 rounded bg-line-2" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      {r.member ? `${r.member.lastName} ${r.member.firstName}` : "該当する社員がいません"}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{r.file.name}</span>
                  </span>
                  {r.status === "done" && (
                    <CheckCircle2 className="size-4 text-wakaba" aria-label="登録済み" />
                  )}
                  {r.status === "error" && <span className="text-xs text-beni">{r.error}</span>}
                  {r.status === "skip" && <span className="text-xs text-ink-3">登録しません</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
