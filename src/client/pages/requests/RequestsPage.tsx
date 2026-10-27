import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, FilePenLine, Inbox, Undo2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { CHANGE_REQUEST_STATUS_LABELS } from "../../../shared/constants";
import { formatDateTimeJa } from "../../../shared/dates";
import type { ChangeRequest, FieldValue, SheetField } from "../../../shared/types";
import { MemberChip } from "../../components/Face";
import { FieldValueView } from "../../components/pickers";
import {
  Badge,
  Button,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Tabs,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import { errorMessage, get, post } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";

const STATUS_TONE = {
  pending: "yamabuki",
  approved: "wakaba",
  rejected: "beni",
  withdrawn: "neutral",
} as const;

function StatusBadge({ status }: { status: ChangeRequest["status"] }) {
  return <Badge tone={STATUS_TONE[status]}>{CHANGE_REQUEST_STATUS_LABELS[status]}</Badge>;
}

function isBlank(v: FieldValue | undefined): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function sameValue(field: SheetField, a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  if (field.type === "checkbox") return !!a === !!b;
  if (Array.isArray(a) && Array.isArray(b))
    return [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function useInvalidateRequests() {
  return (r: ChangeRequest) => {
    queryClient.invalidateQueries({ queryKey: ["requests"] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["member", r.member.id, "sheets"] });
  };
}

export default function RequestsPage() {
  const me = useAuth();
  return me.capabilities.reviewRequests ? <ReviewerView /> : <RequesterView />;
}

/** 人事など承認者向け */
function ReviewerView() {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const pending = useQuery({
    queryKey: ["requests", "pending"],
    queryFn: () => get<{ items: ChangeRequest[] }>("/requests?status=pending"),
  });
  const all = useQuery({
    queryKey: ["requests", "all"],
    queryFn: () => get<{ items: ChangeRequest[] }>("/requests?status=all"),
    enabled: tab === "all",
  });
  const current = tab === "pending" ? pending : all;
  const items = current.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="申請"
        description="社員からのシート変更の申請です。内容を確認して承認すると、プロフィールに反映されます。"
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "pending", label: "承認待ち", count: pending.data?.items.length },
          { value: "all", label: "すべて", count: all.data?.items.length },
        ]}
      />
      {current.isLoading && <Loading />}
      {current.error && <ErrorBox error={current.error} onRetry={() => current.refetch()} />}
      {current.data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState
            icon={<Inbox className="size-10" />}
            title={tab === "pending" ? "承認待ちの申請はありません" : "申請はまだありません"}
          >
            {tab === "pending"
              ? "社員が閲覧のみのシートの変更を申請すると、ここに表示されます。"
              : "社員がシートの変更を申請すると、ここに表示されます。"}
          </EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <ul className="space-y-4">
          {items.map((r) => (
            <li key={r.id}>
              <RequestCard request={r} reviewer />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 一般社員向け：自分の申請 */
function RequesterView() {
  const me = useAuth();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["requests", "mine"],
    queryFn: () => get<{ items: ChangeRequest[] }>("/requests"),
  });
  const items = data?.items ?? [];
  return (
    <div>
      <PageHeader title="申請" description="自分の情報の変更申請と、その状況を確認できます。" />
      <section className="mb-5 flex gap-3 rounded-lg border border-ai-100 bg-ai-50 px-4 py-3 text-sm">
        <FilePenLine className="mt-0.5 size-5 shrink-0 text-ai-600" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-bold">変更を申請するには</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
            住所や通勤手段など、自分では編集できない情報は申請で変更します。
            {me.member ? (
              <Link to={`/members/${me.member.id}`} className="mx-0.5 font-bold text-ai-700 hover:underline">
                自分のプロフィール
              </Link>
            ) : (
              "自分のプロフィール"
            )}
            を開き、「閲覧のみ」のシートで「変更を申請」を選んでください。人事担当が承認すると反映されます。
          </p>
        </div>
      </section>

      {isLoading && <Loading />}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState icon={<Inbox className="size-10" />} title="申請はまだありません">
            変更を申請すると、ここで承認の状況を確認できます。
          </EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <ul className="space-y-4">
          {items.map((r) => (
            <li key={r.id}>
              <RequestCard request={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestCard({ request: r, reviewer }: { request: ChangeRequest; reviewer?: boolean }) {
  const me = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidateRequests();
  const [reviewing, setReviewing] = useState<"approve" | "reject" | null>(null);
  const isMine = me.member?.id === r.member.id;
  const pending = r.status === "pending";

  const withdraw = useMutation({
    mutationFn: () => post(`/requests/${r.id}/withdraw`),
    onSuccess: () => {
      invalidate(r);
      toast("申請を取り下げました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <article className={cx("rounded-lg border bg-white", pending ? "border-line" : "border-line-2")}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-2 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          {reviewer && <MemberChip member={r.member} size={36} />}
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-bold">「{r.sheetName}」の変更</span>
              <StatusBadge status={r.status} />
            </p>
            <p className="tabular text-xs text-ink-3">
              申請日 {formatDateTimeJa(r.createdAt)}
              {reviewer &&
                r.requesterName &&
                r.requesterName !== `${r.member.lastName} ${r.member.firstName}` && (
                  <span className="ml-3">申請者 {r.requesterName}</span>
                )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {reviewer && pending && (
            <>
              <Button
                size="sm"
                variant="danger"
                icon={<X className="size-3.5" />}
                onClick={() => setReviewing("reject")}
              >
                却下
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Check className="size-3.5" />}
                onClick={() => setReviewing("approve")}
              >
                承認
              </Button>
            </>
          )}
          {isMine && pending && (
            <Button
              size="sm"
              icon={<Undo2 className="size-3.5" />}
              loading={withdraw.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: "この申請を取り下げますか？",
                    message: "取り下げた申請は元に戻せません。内容を直して申請し直すことはできます。",
                    confirmLabel: "取り下げる",
                    danger: true,
                  })
                )
                  withdraw.mutate();
              }}
            >
              取り下げる
            </Button>
          )}
        </div>
      </header>

      <div className="space-y-3 px-4 py-3">
        <p className="text-sm">
          <span className="mr-2 text-xs text-ink-3">理由</span>
          <span className="whitespace-pre-wrap">{r.reason}</span>
        </p>
        <DiffTable request={r} />
        {r.status === "rejected" && (
          <div className="rounded-md border border-beni/30 bg-beni-100 px-3 py-2 text-sm">
            <p className="text-xs font-bold text-beni">
              却下の理由{r.reviewerName && <span className="ml-2 font-normal">{r.reviewerName}</span>}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap">{r.reviewComment || "理由は書かれていません"}</p>
          </div>
        )}
        {r.status === "approved" && (
          <p className="text-xs text-ink-3">
            {r.reviewerName ?? "人事担当"}が{formatDateTimeJa(r.reviewedAt)}に承認しました
            {r.reviewComment && (
              <span className="ml-1 text-ink-2">
                （コメント：<span className="whitespace-pre-wrap">{r.reviewComment}</span>）
              </span>
            )}
          </p>
        )}
        {r.status === "withdrawn" && (
          <p className="text-xs text-ink-3">{formatDateTimeJa(r.reviewedAt)}に取り下げられました</p>
        )}
      </div>

      {reviewing && <ReviewDialog request={r} mode={reviewing} onClose={() => setReviewing(null)} />}
    </article>
  );
}

function DiffTable({ request: r }: { request: ChangeRequest }) {
  const fields = r.fields.filter((f) => String(f.id) in r.payload);
  // 承認済みの申請は「変更前」が現在の値（反映後）になるため、申請した値だけを出す
  const applied = r.status === "approved";
  const before = r.before ?? {};
  const rows = fields.map((f) => ({
    field: f,
    before: before[String(f.id)],
    after: r.payload[String(f.id)],
    changed: !sameValue(f, before[String(f.id)], r.payload[String(f.id)]),
  }));
  const changedCount = rows.filter((x) => x.changed).length;
  if (!rows.length) return <p className="text-sm text-ink-3">変更する項目はありません。</p>;
  return (
    <div className="overflow-hidden rounded-md border border-line-2">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">変更内容</caption>
        <thead className="border-b border-line-2 bg-canvas/60 text-left text-xs text-ink-3">
          <tr>
            <th className="w-28 px-3 py-1.5 font-normal sm:w-48">項目</th>
            {applied ? (
              <th className="px-3 py-1.5 font-normal">反映した値</th>
            ) : (
              <>
                <th className="px-3 py-1.5 font-normal">{r.status === "pending" ? "変更前" : "現在の値"}</th>
                <th className="w-6 px-0 py-1.5 sm:w-8" aria-hidden />
                <th className="px-3 py-1.5 font-normal">変更後</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-2">
          {rows.map(({ field, before: b, after, changed }) => (
            <tr key={field.id} className={cx(!applied && changed && "bg-yamabuki-50")}>
              <th scope="row" className="px-3 py-2 text-left align-top font-normal break-words text-ink-2">
                <span className="flex items-center gap-1.5">
                  {!applied && changed && <span className="h-3.5 w-1 rounded-full bg-yamabuki" aria-hidden />}
                  {field.label}
                  {!applied && changed && <span className="sr-only">（変更あり）</span>}
                </span>
              </th>
              {applied ? (
                <td className="px-3 py-2 align-top">
                  <FieldValueView field={field} value={after} />
                </td>
              ) : (
                <>
                  <td
                    className={cx(
                      "px-2 py-2 align-top break-words sm:px-3",
                      changed ? "text-ink-2" : "text-ink-3",
                    )}
                  >
                    <FieldValueView field={field} value={b} />
                  </td>
                  <td className="px-0 py-2 text-center align-top text-ink-3" aria-hidden>
                    →
                  </td>
                  <td
                    className={cx(
                      "px-2 py-2 align-top break-words sm:px-3",
                      changed ? "font-bold" : "text-ink-3",
                    )}
                  >
                    <FieldValueView field={field} value={after} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!applied && (
        <p className="border-t border-line-2 px-3 py-1.5 text-xs text-ink-3">
          {changedCount > 0 ? `${changedCount}項目が変わります` : "現在の値と同じ内容です"}
        </p>
      )}
    </div>
  );
}

function ReviewDialog({
  request: r,
  mode,
  onClose,
}: {
  request: ChangeRequest;
  mode: "approve" | "reject";
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateRequests();
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const reject = mode === "reject";
  const error = reject && touched && !comment.trim() ? "却下の理由を入力してください" : null;
  const submit = useMutation({
    mutationFn: () => post(`/requests/${r.id}/${mode}`, { comment: comment.trim() }),
    onSuccess: () => {
      invalidate(r);
      toast(reject ? "申請を却下しました" : "申請を承認しました。プロフィールに反映しました");
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const name = `${r.member.lastName} ${r.member.firstName}`;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={reject ? "申請を却下" : "申請を承認"}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant={reject ? "danger" : "primary"}
            loading={submit.isPending}
            onClick={() => {
              setTouched(true);
              if (reject && !comment.trim()) return;
              submit.mutate();
            }}
          >
            {reject ? "却下する" : "承認する"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-2">
        {reject
          ? `${name}さんの「${r.sheetName}」の変更を却下します。理由は申請者に表示されます。`
          : `${name}さんの「${r.sheetName}」に申請の内容を反映します。`}
      </p>
      <Field
        label={reject ? "却下の理由" : "コメント（任意）"}
        required={reject}
        htmlFor="review-comment"
        error={error}
      >
        <Textarea
          id="review-comment"
          rows={3}
          maxLength={1000}
          value={comment}
          aria-invalid={error ? true : undefined}
          placeholder={reject ? "例：証明書類の提出が必要です" : "例：確認しました"}
          onChange={(e) => setComment(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
