import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, ChevronRight, ListPlus, Mail, MapPin, Pencil, Phone, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { GENDER_LABELS } from "../../../shared/constants";
import { ageOn, formatDateJa, tenureYears, todayJst } from "../../../shared/dates";
import type { MemberDetail, MemberList, MemberSheetView, MemberTransfer } from "../../../shared/types";
import { faceSrc, StatusBadge } from "../../components/Face";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Loading,
  Modal,
  Select,
  Tabs,
  useConfirm,
  useToast,
} from "../../components/ui";
import { api, del, errorMessage, get, post } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import { MemberFormDialog } from "./MemberFormDialog";
import { EvaluationHistory, OneOnOneTab, SkillsTab, TransferTimeline } from "./ProfileTabs";
import { SheetPanel } from "./SheetPanel";

async function resizeImage(file: File, size = 480): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const s = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("画像を変換できませんでした"))),
      "image/jpeg",
      0.86,
    ),
  );
}

export default function MemberProfilePage() {
  const { id } = useParams();
  const memberId = Number(id);
  const me = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [tab, setTab] = useState("profile");
  const [editing, setEditing] = useState(false);
  const [addingToList, setAddingToList] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const member = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => get<MemberDetail>(`/members/${memberId}`),
  });
  const sheets = useQuery({
    queryKey: ["member", memberId, "sheets"],
    queryFn: () => get<{ items: MemberSheetView[] }>(`/members/${memberId}/sheets`),
  });
  const transfers = useQuery({
    queryKey: ["member", memberId, "transfers"],
    queryFn: () => get<{ items: MemberTransfer[] }>(`/members/${memberId}/transfers`),
  });
  const memberLists = useQuery({
    queryKey: ["member", memberId, "lists"],
    queryFn: () =>
      get<{ items: { id: number; name: string; color: string }[] }>(`/lists/of-member/${memberId}`),
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const blob = await resizeImage(file);
      return api(`/members/${memberId}/photo`, {
        method: "PUT",
        body: blob,
        headers: { "content-type": "image/jpeg" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", memberId] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast("顔写真を更新しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const removePhoto = useMutation({
    mutationFn: () => del(`/members/${memberId}/photo`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", memberId] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast("顔写真を削除しました");
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/members/${memberId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast("社員を削除しました");
      navigate("/members");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  if (member.isLoading) return <Loading />;
  if (member.error || !member.data) return <ErrorBox error={member.error} onRetry={() => member.refetch()} />;
  const m = member.data;
  const today = todayJst();
  const age = ageOn(m.birthDate, today);
  const tenure = tenureYears(m.hireDate, today);
  const canOneOnOne = me.capabilities.writeOneOnOnes && m.inScope && !m.isSelf;

  const tabs = [
    { value: "profile", label: "プロフィール" },
    ...(sheets.data?.items ?? []).map((s) => ({ value: `sheet-${s.sheet.id}`, label: s.sheet.name })),
    { value: "skills", label: "スキル" },
    ...(m.inScope ? [{ value: "evaluations", label: "評価" }] : []),
    ...(m.inScope || m.isSelf ? [{ value: "oneonones", label: "1on1・面談" }] : []),
  ];
  const activeSheet = sheets.data?.items.find((s) => `sheet-${s.sheet.id}` === tab);

  return (
    <div>
      <nav aria-label="パンくず" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
        <Link to="/members" className="hover:text-ai-700">
          メンバー
        </Link>
        {m.path.map((p) => (
          <span key={p.id} className="flex items-center gap-1">
            <ChevronRight className="size-3" />
            <Link to={`/members?departmentId=${p.id}`} className="hover:text-ai-700">
              {p.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* 名札 */}
      <section className="mb-5 overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex flex-col gap-6 p-5 sm:flex-row">
          <div className="relative w-40 shrink-0 self-start">
            <img
              src={faceSrc(m)}
              alt={`${m.lastName} ${m.firstName}`}
              className="aspect-square w-40 rounded-lg bg-ai-50 object-cover"
            />
            {m.canEditPhoto && (
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  className="flex-1"
                  icon={<Camera className="size-3.5" />}
                  loading={uploadPhoto.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  写真を変更
                </Button>
                {m.photoUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="写真を削除"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "顔写真を削除しますか？",
                          message: "イラストのアバター表示に戻ります。",
                          confirmLabel: "削除",
                          danger: true,
                        })
                      )
                        removePhoto.mutate();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadPhoto.mutate(f);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-ink-3">
                  {m.lastNameKana} {m.firstNameKana}
                  <span className="tabular ml-3">{m.employeeCode}</span>
                </p>
                <h1 className="mt-0.5 flex items-center gap-2 text-[28px] leading-tight font-bold">
                  {m.lastName} {m.firstName}
                  <StatusBadge status={m.status} />
                  {m.isSelf && <Badge tone="ai">あなた</Badge>}
                </h1>
                <p className="mt-1 text-[15px] text-ink-2">
                  {m.departmentName ?? "所属なし"}
                  {m.jobTitleName && <span className="ml-2 font-bold text-ink">{m.jobTitleName}</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canOneOnOne && (
                  <Button size="sm" onClick={() => setTab("oneonones")}>
                    1on1を記録
                  </Button>
                )}
                <Button
                  size="sm"
                  icon={<ListPlus className="size-4" />}
                  onClick={() => setAddingToList(true)}
                >
                  リストに追加
                </Button>
                {m.canEditBasic && (
                  <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                    基本情報を編集
                  </Button>
                )}
                {me.user.role === "admin" && !m.isSelf && (
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label="社員を削除"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `${m.lastName} ${m.firstName}さんを削除しますか？`,
                          message:
                            "シート・評価・面談記録などもすべて削除され、元に戻せません。退職者は在籍状況を「退職」にする運用がおすすめです。",
                          confirmLabel: "削除",
                          danger: true,
                        })
                      )
                        remove.mutate();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-xs text-ink-3">入社日</dt>
                <dd>
                  {formatDateJa(m.hireDate)}
                  {tenure !== null && <span className="ml-1 text-xs text-ink-3">（{tenure}年）</span>}
                </dd>
              </div>
              {m.birthDate !== null && (
                <div>
                  <dt className="text-xs text-ink-3">生年月日</dt>
                  <dd>
                    {formatDateJa(m.birthDate)}
                    {age !== null && <span className="ml-1 text-xs text-ink-3">（{age}歳）</span>}
                  </dd>
                </div>
              )}
              {m.gender !== null && (
                <div>
                  <dt className="text-xs text-ink-3">性別</dt>
                  <dd>{GENDER_LABELS[m.gender]}</dd>
                </div>
              )}
              {m.gradeName !== null && (
                <div>
                  <dt className="text-xs text-ink-3">等級・雇用形態</dt>
                  <dd>
                    {m.gradeName} ・ {m.employmentTypeName ?? "—"}
                  </dd>
                </div>
              )}
              {m.leaveDate && (
                <div>
                  <dt className="text-xs text-ink-3">退職日</dt>
                  <dd>{formatDateJa(m.leaveDate)}</dd>
                </div>
              )}
            </dl>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
              {m.workLocation && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-ink-3" />
                  {m.workLocation}
                </span>
              )}
              {m.email && (
                <a href={`mailto:${m.email}`} className="flex items-center gap-1.5 hover:text-ai-700">
                  <Mail className="size-3.5 text-ink-3" />
                  {m.email}
                </a>
              )}
              {m.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="size-3.5 text-ink-3" />
                  {m.phone}
                </span>
              )}
            </div>
            {memberLists.data && memberLists.data.items.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {memberLists.data.items.map((l) => (
                  <Link key={l.id} to={`/lists/${l.id}`}>
                    <Badge
                      tone={
                        (["ai", "yamabuki", "wakaba", "beni", "fuji"].includes(l.color)
                          ? l.color
                          : "ai") as "ai"
                      }
                    >
                      {l.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />

      {tab === "profile" && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="rounded-lg border border-line bg-white p-5">
            <h2 className="mb-2 text-[15px] font-bold">ひとこと</h2>
            {m.bio ? (
              <p className="max-w-[70ch] text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{m.bio}</p>
            ) : (
              <p className="text-sm text-ink-3">まだ書かれていません。</p>
            )}
            {m.isSelf && <SelfBioEditor member={m} />}
            <h2 className="mt-6 mb-3 text-[15px] font-bold">得意なスキル</h2>
            <SkillsTab memberId={memberId} compact />
          </section>
          <section className="rounded-lg border border-line bg-white p-5">
            <h2 className="mb-3 text-[15px] font-bold">異動・役職の履歴</h2>
            {m.inScope ? (
              <TransferTimeline items={transfers.data?.items ?? []} hireDate={m.hireDate} />
            ) : (
              <p className="text-sm text-ink-3">閲覧する権限がありません。</p>
            )}
          </section>
        </div>
      )}
      {activeSheet && <SheetPanel key={activeSheet.sheet.id} memberId={memberId} view={activeSheet} />}
      {tab === "skills" && (
        <section className="rounded-lg border border-line bg-white p-5">
          <SkillsTab
            memberId={memberId}
            editable={me.capabilities.manageMembers || m.isSelf || (me.user.role === "manager" && m.inScope)}
          />
        </section>
      )}
      {tab === "evaluations" && <EvaluationHistory memberId={memberId} />}
      {tab === "oneonones" && <OneOnOneTab member={m} canCreate={canOneOnOne} />}

      {editing && <MemberFormDialog open onClose={() => setEditing(false)} member={m} />}
      <AddToListDialog open={addingToList} onClose={() => setAddingToList(false)} memberId={memberId} />
    </div>
  );
}

function SelfBioEditor({ member }: { member: MemberDetail }) {
  const [open, setOpen] = useState(false);
  const [bio, setBio] = useState(member.bio);
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api(`/members/${member.id}`, { method: "PATCH", json: { bio } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", member.id] });
      toast("ひとことを保存しました");
      setOpen(false);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  if (!open)
    return (
      <Button
        size="sm"
        variant="ghost"
        className="mt-2 -ml-2"
        icon={<Pencil className="size-3.5" />}
        onClick={() => setOpen(true)}
      >
        ひとことを編集
      </Button>
    );
  return (
    <div className="mt-3 space-y-2">
      <textarea
        aria-label="ひとこと"
        className="w-full rounded-md border border-line p-2 text-sm focus:border-ai-500 focus:ring-2 focus:ring-ai-100 focus:outline-none"
        rows={4}
        value={bio}
        onChange={(e) => setBio(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          保存
        </Button>
        <Button size="sm" onClick={() => setOpen(false)}>
          キャンセル
        </Button>
      </div>
    </div>
  );
}

function AddToListDialog({
  open,
  onClose,
  memberId,
}: {
  open: boolean;
  onClose: () => void;
  memberId: number;
}) {
  const toast = useToast();
  const lists = useQuery({
    queryKey: ["lists"],
    queryFn: () => get<{ items: MemberList[] }>("/lists"),
    enabled: open,
  });
  const [listId, setListId] = useState("");
  const own = (lists.data?.items ?? []).filter((l) => l.isOwner);
  const add = useMutation({
    mutationFn: () => post(`/lists/${listId}/members`, { memberIds: [memberId] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["member", memberId, "lists"] });
      toast("社員リストに追加しました");
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="社員リストに追加"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" disabled={!listId} loading={add.isPending} onClick={() => add.mutate()}>
            追加
          </Button>
        </>
      }
    >
      {own.length === 0 ? (
        <p className="text-sm text-ink-2">
          自分のリストがありません。
          <Link to="/lists" className="font-bold text-ai-700 underline">
            社員リスト
          </Link>
          から作成してください。
        </p>
      ) : (
        <Field label="追加先のリスト">
          <Select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">選択してください</option>
            {own.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}
