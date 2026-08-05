import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'bottom',
  align = 'center',
  shortcut,
  delay = 350,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  shortcut?: string;
  delay?: number;
}) {
  if (!content) return <>{children}</>;

  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md border border-line-strong glass px-2 py-1 text-[11.5px] text-ink shadow-[var(--shadow-float)] data-[state=delayed-open]:[animation:pop-in_120ms_var(--ease-out-soft)]"
        >
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[4px] border border-line-strong bg-[#ffffff0a] px-1 font-sans text-[10px] font-medium text-ink-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded font-medium leading-none [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'bg-[#ffffff0d] text-ink-muted',
        accent: 'bg-accent/15 text-accent',
        positive: 'bg-positive/15 text-positive',
        caution: 'bg-caution/15 text-caution',
        negative: 'bg-negative/15 text-negative',
        violet: 'bg-violet/15 text-violet',
        outline: 'border border-line-strong text-ink-muted',
      },
      size: {
        sm: 'h-[16px] px-1.5 text-[10px]',
        md: 'h-[19px] px-2 text-[11px]',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'sm' },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <div
      role="separator"
      className={cn(
        'shrink-0 bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  );
}

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex items-center gap-0.5 border-b border-line px-2', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative -mb-px flex h-9 select-none items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[12.5px] font-medium text-ink-muted transition-colors after:absolute after:inset-x-1 after:inset-y-1 after:-z-10 after:rounded after:transition-colors hover:text-ink-soft hover:after:bg-[#ffffff08] data-[state=active]:border-accent data-[state=active]:text-ink [&_svg]:size-3.5',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('min-h-0 flex-1 focus-visible:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent',
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded bg-[#ffffff08]', className)}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[#ffffff0d] to-transparent [animation:shimmer_1.4s_infinite]" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-8 py-12', className)}>
      {icon && (
        <div className="flex size-11 items-center justify-center rounded-xl border border-line bg-[#ffffff06] text-ink-faint [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="space-y-1 text-center">
        <p className="text-[13px] font-medium text-ink-soft">{title}</p>
        {description && (
          <p className="max-w-[380px] text-balance text-[12px] leading-relaxed text-ink-faint">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function StatusDot({
  tone,
  className,
}: {
  tone: 'online' | 'offline' | 'busy' | 'error';
  className?: string;
}) {
  const tones = {
    online: 'bg-positive shadow-[0_0_0_2px_rgb(63_185_80/0.2)]',
    offline: 'bg-ink-faint',
    busy: 'bg-caution shadow-[0_0_0_2px_rgb(216_163_49/0.2)]',
    error: 'bg-negative shadow-[0_0_0_2px_rgb(240_100_90/0.2)]',
  } as const;
  return <span className={cn('size-[6px] shrink-0 rounded-full', tones[tone], className)} />;
}

export function ProgressBar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[#ffffff0d]', className)}>
      {value === null ? (
        <div className="h-full w-1/3 rounded-full bg-accent [animation:shimmer_1.2s_infinite]" />
      ) : (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-[var(--ease-out-soft)]"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      )}
    </div>
  );
}
