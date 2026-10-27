import { ChevronDown, ChevronUp, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { AccessLevel } from "../../../shared/constants";
import { ACCESS_LABELS } from "../../../shared/constants";
import { Badge, IconButton } from "../../components/ui";
import { errorMessage } from "../../lib/api";

/** 設定タブの見出し */
export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-lg leading-tight font-bold">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** ダイアログ内に出す API エラー */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-md bg-beni-100 px-3 py-2 text-sm text-beni" role="alert">
      {errorMessage(error)}
    </p>
  );
}

/** 社員にひもづかないアカウントの代わりの顔 */
export function AccountAvatar({ size = 32 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[5px] bg-ai-100 text-ai-700"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <UserRound className="size-4" />
    </span>
  );
}

/** 並べ替え用の上下ボタン */
export function MoveButtons({
  name,
  index,
  count,
  onMove,
  disabled,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex shrink-0">
      <IconButton
        label={`${name}を上へ移動`}
        className="size-7"
        disabled={disabled || index <= 0}
        onClick={() => onMove(index - 1)}
      >
        <ChevronUp className="size-4" />
      </IconButton>
      <IconButton
        label={`${name}を下へ移動`}
        className="size-7"
        disabled={disabled || index >= count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ChevronDown className="size-4" />
      </IconButton>
    </span>
  );
}

export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = [...arr];
  const [x] = next.splice(from, 1);
  if (x === undefined) return next;
  next.splice(to, 0, x);
  return next;
}

const ACCESS_TONES = { none: "neutral", view: "ai", edit: "wakaba" } as const;

export function AccessBadge({ level }: { level: AccessLevel }) {
  return <Badge tone={ACCESS_TONES[level]}>{ACCESS_LABELS[level]}</Badge>;
}
