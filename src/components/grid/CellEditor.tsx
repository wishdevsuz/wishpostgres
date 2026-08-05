import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { GridColumn } from './types';

/**
 * The inline editor shown after a double click or Enter. It stays a plain
 * input for every type so editing never steals focus into a dialog; the value
 * is validated by PostgreSQL when it is written back.
 */
export function CellEditor({
  column,
  initialValue,
  onCommit,
  onCancel,
}: {
  column: GridColumn;
  initialValue: string | null;
  onCommit: (value: string | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const [isNull, setIsNull] = useState(initialValue === null);
  const inputRef = useRef<HTMLInputElement>(null);
  const multiline = column.typeCategory === 'json' || column.typeCategory === 'text';

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    onCommit(isNull ? null : value);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'Tab') {
      event.stopPropagation();
      commit();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'n' && column.nullable) {
      event.preventDefault();
      setIsNull(true);
      setValue('');
    }
  }

  if (column.typeCategory === 'boolean') {
    return (
      <select
        autoFocus
        value={isNull ? '' : value}
        onChange={(event) => {
          const next = event.target.value;
          setIsNull(next === '');
          setValue(next);
          onCommit(next === '' ? null : next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        onBlur={onCancel}
        className="absolute inset-0 z-20 w-full border border-accent bg-[#0d1014] px-2 text-[12.5px] text-ink outline-none"
      >
        <option value="true">true</option>
        <option value="false">false</option>
        {column.nullable && <option value="">NULL</option>}
      </select>
    );
  }

  if (column.typeCategory === 'enum' && column.enumValues.length > 0) {
    return (
      <select
        autoFocus
        value={isNull ? '' : value}
        onChange={(event) => {
          const next = event.target.value;
          onCommit(next === '' ? null : next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        onBlur={onCancel}
        className="absolute inset-0 z-20 w-full border border-accent bg-[#0d1014] px-2 text-[12.5px] text-ink outline-none"
      >
        {column.enumValues.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {column.nullable && <option value="">NULL</option>}
      </select>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex items-stretch">
      <input
        ref={inputRef}
        type="text"
        inputMode={column.typeCategory === 'number' ? 'decimal' : undefined}
        value={isNull ? '' : value}
        placeholder={isNull ? 'NULL' : undefined}
        onChange={(event) => {
          setIsNull(false);
          setValue(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={commit}
        spellCheck={false}
        className={cn(
          'w-full border border-accent bg-[#0d1014] px-2 font-mono text-[12.5px] text-ink outline-none ring-2 ring-accent/25',
          isNull && 'italic text-ink-faint placeholder:text-ink-faint',
          multiline && 'font-mono',
        )}
      />
    </div>
  );
}
