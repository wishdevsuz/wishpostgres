import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-[#05070a]/70 backdrop-blur-[2px] data-[state=open]:[animation:overlay-in_140ms_var(--ease-out-soft)]',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hideClose?: boolean;
}

const SIZES = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[760px]',
  xl: 'max-w-[1000px]',
} as const;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = 'md', hideClose, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-strong bg-elevated shadow-[var(--shadow-pop)] data-[state=open]:[animation:pop-in_160ms_var(--ease-out-soft)]',
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-[#ffffff0f] hover:text-ink"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({
  title,
  description,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-3 border-b border-line px-5 py-4 pr-12', className)}>
      {icon && (
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#ffffff0a] text-accent [&_svg]:size-4">
          {icon}
        </div>
      )}
      <div className="min-w-0 space-y-1">
        <DialogPrimitive.Title className="text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {title}
        </DialogPrimitive.Title>
        {description && (
          <DialogPrimitive.Description className="text-[12px] leading-relaxed text-ink-muted">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)}>{children}</div>
  );
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-end gap-2 border-t border-line bg-[#ffffff04] px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
