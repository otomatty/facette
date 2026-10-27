import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Modal, useToast } from "../../components/ui";
import { downloadText, errorMessage, get, post } from "../../lib/api";
import { queryClient } from "../../lib/queries";

type Result = {
  dryRun: boolean;
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
  errorCount: number;
  unknownHeaders: string[];
  sheetColumns: string[];
};

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // UTF-8 で読めない場合は Shift_JIS（Excel の既定）として読む
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

export function CsvImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [done, setDone] = useState(false);

  const check = useMutation({
    mutationFn: (dryRun: boolean) => post<Result>("/io/members/import", { csv, dryRun }),
    onSuccess: (r, dryRun) => {
      setResult(r);
      if (!dryRun && !r.dryRun) {
        setDone(true);
        queryClient.invalidateQueries({ queryKey: ["members"] });
        toast(`取り込みました（新規 ${r.created}名・更新 ${r.updated}名）`);
      }
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const template = useMutation({
    mutationFn: () => get<{ filename: string; csv: string }>("/io/members/template"),
    onSuccess: (r) => downloadText(r.filename, r.csv),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="CSV から社員データを取り込む"
      size="lg"
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            閉じる
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>キャンセル</Button>
            <Button
              disabled={!csv}
              loading={check.isPending && check.variables === true}
              onClick={() => check.mutate(true)}
            >
              内容をチェック
            </Button>
            <Button
              variant="primary"
              disabled={!result || result.errorCount > 0 || check.isPending}
              loading={check.isPending && check.variables === false}
              onClick={() => check.mutate(false)}
            >
              取り込む
            </Button>
          </>
        )
      }
    >
      {done && result ? (
        <div className="flex flex-col items-center py-8 text-center">
          <CheckCircle2 className="mb-3 size-10 text-wakaba" />
          <p className="font-bold">取り込みが完了しました</p>
          <p className="mt-1 text-sm text-ink-2">
            新規 {result.created}名・更新 {result.updated}名
          </p>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-ink-2">
            <li>「社員番号」で照合し、一致すれば更新、なければ新規登録します。</li>
            <li>空欄のセルは変更しません。部署は「部署コード」または「部署」名で指定します。</li>
            <li>シートの項目は「シート名:項目名」の列で取り込めます。複数選択は「|」で区切ります。</li>
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-ai-300 bg-ai-50 px-3 font-bold text-ai-800 hover:bg-ai-100">
              <FileSpreadsheet className="size-4" />
              {file ? file.name : "CSV ファイルを選ぶ"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setFile(f);
                  setResult(null);
                  setCsv(await readText(f));
                }}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={() => template.mutate()}>
              取り込み用のテンプレートをダウンロード
            </Button>
          </div>
          {result && (
            <div className="rounded-md border border-line p-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="wakaba">新規 {result.created}名</Badge>
                <Badge tone="ai">更新 {result.updated}名</Badge>
                <Badge tone={result.errorCount ? "beni" : "neutral"}>エラー {result.errorCount}行</Badge>
              </div>
              {result.unknownHeaders.length > 0 && (
                <p className="mt-2 text-xs text-ink-3">
                  取り込まれない列：{result.unknownHeaders.join("、")}
                </p>
              )}
              {result.errorCount > 0 ? (
                <>
                  <p className="mt-3 text-[13px] font-bold text-beni">
                    エラーを直してから、もう一度チェックしてください。
                  </p>
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-[13px]">
                    {result.errors.map((e) => (
                      <li key={e.row} className="flex gap-2">
                        <span className="tabular w-14 shrink-0 text-ink-3">{e.row}行目</span>
                        <span>{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-3 text-[13px] text-wakaba">
                  問題は見つかりませんでした。「取り込む」で反映します。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
