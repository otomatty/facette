import type { DragEvent, ReactNode } from "react";
import { Link } from "react-router";
import type { MemberSummary } from "../../shared/types";
import { avatarDataUrl } from "./avatar";
import { Badge, cx } from "./ui";

type FaceMember = Pick<MemberSummary, "id" | "lastName" | "firstName" | "photoUrl" | "avatarSeed"> &
  Partial<Pick<MemberSummary, "status">>;

export function faceSrc(m: Pick<MemberSummary, "photoUrl" | "avatarSeed">): string {
  return m.photoUrl ?? avatarDataUrl(m.avatarSeed);
}

/** 顔写真（未登録ならイラスト）を表示する */
export function Face({
  member,
  size = 40,
  className,
  rounded = "md",
}: {
  member: FaceMember;
  size?: number;
  className?: string;
  rounded?: "md" | "full";
}) {
  return (
    <img
      src={faceSrc(member)}
      alt={`${member.lastName} ${member.firstName}`}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className={cx(
        "shrink-0 bg-ai-50 object-cover",
        rounded === "full" ? "rounded-full" : "rounded-[5px]",
        member.status === "retired" && "grayscale",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

export function StatusBadge({ status }: { status: MemberSummary["status"] }) {
  if (status === "leave") return <Badge tone="yamabuki">休職</Badge>;
  if (status === "retired") return <Badge>退職</Badge>;
  return null;
}

/** 顔一覧のタイル（名札型） */
export function FaceTile({
  member,
  href,
  selected,
  onClick,
  draggable,
  onDragStart,
  footer,
  compact,
  highlight,
}: {
  member: MemberSummary;
  href?: string;
  selected?: boolean;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  footer?: ReactNode;
  compact?: boolean;
  highlight?: boolean;
}) {
  const body = (
    <>
      <div className="relative">
        <img
          src={faceSrc(member)}
          alt=""
          loading="lazy"
          draggable={false}
          className={cx(
            "aspect-square w-full bg-ai-50 object-cover",
            member.status === "retired" && "grayscale",
            member.status === "leave" && "opacity-80",
          )}
        />
        {member.status !== "active" && (
          <div className="absolute top-1.5 left-1.5">
            <StatusBadge status={member.status} />
          </div>
        )}
      </div>
      <div className={cx("border-t border-line-2 px-2", compact ? "py-1" : "py-1.5")}>
        <div className={cx("truncate font-bold", compact ? "text-[12px]" : "text-[13px]")}>
          {member.lastName} {member.firstName}
        </div>
        {!compact && (
          <div className="truncate text-[11px] text-ink-3">
            {[member.departmentName, member.jobTitleName !== "メンバー" ? member.jobTitleName : null]
              .filter(Boolean)
              .join(" / ") || "所属なし"}
          </div>
        )}
        {footer}
      </div>
    </>
  );
  const cls = cx(
    "group block overflow-hidden rounded-tile border bg-white text-left transition-[border-color,box-shadow]",
    selected
      ? "border-ai-600 ring-2 ring-ai-200"
      : "border-line hover:border-ai-300 hover:shadow-[0_4px_14px_-6px_rgba(22,38,61,.35)]",
    highlight && "border-yamabuki ring-2 ring-yamabuki-100",
    draggable && "cursor-grab active:cursor-grabbing",
  );
  if (href) {
    return (
      <Link
        to={href}
        className={cls}
        draggable={draggable}
        onDragStart={onDragStart}
        aria-label={`${member.lastName} ${member.firstName}`}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cls}
      draggable={draggable}
      onDragStart={onDragStart}
      aria-pressed={selected}
      aria-label={`${member.lastName} ${member.firstName}`}
    >
      {body}
    </button>
  );
}

/** 顔と名前を横並びで表示する小さな部品 */
export function MemberChip({
  member,
  sub,
  size = 32,
  link = true,
}: {
  member: MemberSummary;
  sub?: ReactNode;
  size?: number;
  link?: boolean;
}) {
  const content = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Face member={member} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold group-hover:text-ai-700">
          {member.lastName} {member.firstName}
        </span>
        <span className="block truncate text-xs text-ink-3">
          {sub ?? ([member.departmentName, member.jobTitleName].filter(Boolean).join(" / ") || "所属なし")}
        </span>
      </span>
    </span>
  );
  if (!link) return content;
  return (
    <Link to={`/members/${member.id}`} className="group min-w-0">
      {content}
    </Link>
  );
}

/** 重なった顔のまとまり */
export function FaceStack({
  members,
  max = 5,
  size = 28,
}: {
  members: FaceMember[];
  max?: number;
  size?: number;
}) {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <Face
          key={m.id}
          member={m}
          size={size}
          rounded="full"
          className={cx("ring-2 ring-white", i > 0 && "-ml-2")}
        />
      ))}
      {rest > 0 && (
        <span
          className="-ml-2 flex items-center justify-center rounded-full bg-line-2 text-[11px] font-bold text-ink-2 ring-2 ring-white"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
