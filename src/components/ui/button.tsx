import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-[var(--ease-out-soft)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-[#08172b] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] hover:bg-[#76b6ff] active:bg-[#4e97ee]',
        secondary:
          'border border-line-strong bg-elevated text-ink hover:border-[#3a424f] hover:bg-overlay active:bg-[#1f242c]',
        ghost: 'text-ink-soft hover:bg-[#ffffff0d] hover:text-ink active:bg-[#ffffff14]',
        subtle: 'bg-[#ffffff0a] text-ink-soft hover:bg-[#ffffff14] hover:text-ink',
        danger: 'bg-negative text-[#2a0906] hover:bg-[#f57b72] active:bg-[#df584e]',
        dangerGhost: 'text-negative hover:bg-[#f0645a1f] active:bg-[#f0645a2e]',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 px-2 text-[11px] [&_svg]:size-3',
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-8 px-3 text-[13px] [&_svg]:size-4',
        lg: 'h-10 px-5 text-sm [&_svg]:size-4',
        icon: 'size-8 [&_svg]:size-4',
        iconSm: 'size-7 [&_svg]:size-3.5',
        iconXs: 'size-6 [&_svg]:size-3',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Component = asChild ? Slot : 'button';
    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </Component>
    );
  },
);
Button.displayName = 'Button';
