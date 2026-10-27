import { useMutation, useQuery } from "@tanstack/react-query";
import { Megaphone, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDateTimeJa } from "../../../shared/dates";
import type { Announcement } from "../../../shared/types";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, get, patch, post } from "../../lib/api";
import { queryClient } from "../../lib/queries";
import { FormError, SectionHeader } from "./common";

function invalidateAnnouncements() {
  queryClient.invalidateQueries({ queryKey: ["announcements"] });
  queryClient.invalidateQueries({ queryKey: ["home"] });
}

export function AnnouncementsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const list = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => (await get<{ items: Announcement[] }>("/announcements")).items,
  });
  const remove = useMutation({
    mutationFn: (a: Announcement) => del(`/announcements/${a.id}`),
    onSuccess: (_, a) => {
      invalidateAnnouncements();
      toast(`お知らせ「${a.title}」を削除しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const items = list.data ?? [];

  return (
    <div>
      <SectionHeader
        title="お知らせ"
        description="全社員のホーム画面に表示されます。上部に固定したお知らせは、新しいものより先に表示されます。"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            お知らせを投稿
          </Button>
        }
      />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {list.data && (
        <div className="rounded-lg border border-line bg-white">
          {items.length === 0 ? (
            <EmptyState icon={<Megaphone className="size-10" />} title="お知らせはまだありません">
              お知らせを投稿すると、全社員のホーム画面に表示されます。
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line-2">
              {items.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-3.5 pr-2 pl-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.pinned && (
                        <Badge tone="yamabuki">
                          <Pin className="mr-0.5 size-3" aria-hidden />
                          固定
                        </Badge>
                      )}
                      <h3 className="text-sm font-bold">{a.title}</h3>
                    </div>
                    {a.body && (
                      <p className="mt-1 line-clamp-3 max-w-[72ch] text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">
                        {a.body}
                      </p>
                    )}
                    <p className="mt-1.5 text-[11px] text-ink-3">
                      <span className="tabular">{formatDateTimeJa(a.publishedAt)}</span>
                      {a.authorName && <span className="ml-2">{a.authorName}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    <IconButton label={`「${a.title}」を編集`} onClick={() => setEditing(a)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label={`「${a.title}」を削除`}
                      className="hover:bg-beni-100 hover:text-beni"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "このお知らせを削除しますか？",
                            message: `「${a.title}」はホーム画面からも消え、元に戻せません。`,
                            confirmLabel: "削除",
                            danger: true,
                          })
                        )
                          remove.mutate(a);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {editing && (
        <AnnouncementDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function AnnouncementDialog({ item, onClose }: { item: Announcement | null; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [pinned, setPinned] = useState(item?.pinned ?? false);
  const save = useMutation({
    mutationFn: () => {
      const payload = { title: title.trim(), body: body.trim(), pinned };
      return item ? patch(`/announcements/${item.id}`, payload) : post("/announcements", payload);
    },
    onSuccess: () => {
      invalidateAnnouncements();
      toast(item ? "お知らせを保存しました" : "お知らせを投稿しました");
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={item ? "お知らせを編集" : "お知らせを投稿"}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {item ? "保存" : "投稿する"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <FormError error={save.error} />
        <Field label="タイトル" required htmlFor="an-title">
          <Input
            id="an-title"
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="本文" htmlFor="an-body" help={`${body.length} / 4000文字`}>
          <Textarea
            id="an-body"
            rows={7}
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <div>
          <Checkbox label="上部に固定する" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <p className="mt-1 text-xs text-ink-3">
            固定すると、ホーム画面のお知らせの先頭に表示され続けます。
          </p>
        </div>
        {item && (
          <p className="text-xs text-ink-3">
            編集しても投稿日時は変わりません（{formatDateTimeJa(item.publishedAt)}）。
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
