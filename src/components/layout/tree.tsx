import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/misc';

export function TreeSection({
  label,
  icon,
  open,
  onToggle,
  count,
  actions,
  loading,
  children,
}: {
  label: string;
  icon?: ReactNode;
  open: boolean;
  onToggle: () => void;
  count?: number;
  actions?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="select-none">
      <div className="group/section flex h-[26px] items-center gap-1 rounded-md pl-1 pr-1 hover:bg-[#ffffff08]">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-ink-faint transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
          {icon && <span className="flex shrink-0 text-ink-muted [&_svg]:size-3.5">{icon}</span>}
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
            {label}
          </span>
          {loading ? (
            <Spinner className="size-3 text-ink-faint" />
          ) : (
            count !== undefined && <span className="text-[10.5px] text-ink-faint">{count}</span>
          )}
        </button>
        {actions && (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
            {actions}
          </span>
        )}
      </div>
      {open && <div className="mt-0.5 space-y-px">{children}</div>}
    </div>
  );
}

export function TreeItem({
  label,
  icon,
  active,
  depth = 0,
  meta,
  actions,
  onClick,
  onDoubleClick,
  className,
  title,
}: {
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  depth?: number;
  meta?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  onDoubleClick?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={cn(
        'group/item relative flex h-[26px] items-center rounded-md pr-1 transition-colors',
        active ? 'bg-accent/15 text-ink' : 'text-ink-soft hover:bg-[#ffffff0a]',
        className,
      )}
      style={{ paddingLeft: 6 + depth * 13 }}
    >
      {active && <span className="absolute left-0 h-3.5 w-[2px] rounded-r bg-accent" />}
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        title={title}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {icon && (
          <span
            className={cn(
              'flex shrink-0 [&_svg]:size-3.5',
              active ? 'text-accent' : 'text-ink-faint',
            )}
          >
            {icon}
          </span>
        )}
        <span className="truncate text-[12.5px]">{label}</span>
        {meta && <span className="ml-auto shrink-0 pl-2 text-[10.5px] text-ink-faint">{meta}</span>}
      </button>
      {actions && (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
          {actions}
        </span>
      )}
    </div>
  );
}

export function TreeMessage({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1.5 text-[11.5px] leading-snug text-ink-faint">{children}</p>;
}

export function TreeSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-1 px-2 py-1">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-[14px] rounded bg-[#ffffff08]"
          style={{ width: `${58 + ((index * 37) % 38)}%` }}
        />
      ))}
    </div>
  );
}
