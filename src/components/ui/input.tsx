import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

const fieldStyles =
  'w-full rounded-md border border-line-strong bg-[#0d1014] text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, leading, trailing, ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        className={cn(
          fieldStyles,
          'h-8 px-2.5 text-[13px]',
          leading && 'pl-8',
          trailing && 'pr-8',
          invalid && 'border-negative focus:border-negative focus:ring-negative/25',
          className,
        )}
        {...props}
      />
    );

    if (!leading && !trailing) return field;

    return (
      <div className="relative flex items-center">
        {leading && (
          <span className="pointer-events-none absolute left-2.5 flex text-ink-muted [&_svg]:size-3.5">
            {leading}
          </span>
        )}
        {field}
        {trailing && <span className="absolute right-1.5 flex items-center">{trailing}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        fieldStyles,
        'min-h-[68px] resize-y px-2.5 py-2 text-[13px] leading-relaxed',
        invalid && 'border-negative focus:border-negative focus:ring-negative/25',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
