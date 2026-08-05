import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { ColumnMeta } from '@/types';

type Pending =
  | { kind: 'rename'; column: ColumnMeta }
  | { kind: 'type'; column: ColumnMeta }
  | { kind: 'default'; column: ColumnMeta }
  | { kind: 'comment'; column: ColumnMeta }
  | { kind: 'drop'; column: ColumnMeta }
  | null;

const COPY: Record<
  'rename' | 'type' | 'default' | 'comment',
  { title: string; label: string; hint: string; placeholder: string }
> = {
  rename: {
    title: 'Rename column',
    label: 'New name',
    hint: 'Views, indexes and constraints that reference the column follow the rename.',
    placeholder: 'new_name',
  },
  type: {
    title: 'Change type',
    label: 'New data type',
    hint: 'PostgreSQL rewrites the table and casts every existing value.',
    placeholder: 'text',
  },
  default: {
    title: 'Set default',
    label: 'Default expression',
    hint: 'Leave empty to drop the default. Existing rows are not changed.',
    placeholder: "now()",
  },
  comment: {
    title: 'Set comment',
    label: 'Comment',
    hint: 'Leave empty to remove the comment.',
    placeholder: 'What this column holds',
  },
};

export function InlineEditPrompt({
  pending,
  onCancel,
  onSubmit,
  busy,
}: {
  pending: Pending;
  onCancel: () => void;
  onSubmit: (action: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState('');
  const kind = pending && pending.kind !== 'drop' ? pending.kind : null;

  useEffect(() => {
    if (!pending || pending.kind === 'drop') return;
    setValue(
      pending.kind === 'rename'
        ? pending.column.name
        : pending.kind === 'type'
          ? pending.column.dataType
          : pending.kind === 'default'
            ? (pending.column.default ?? '')
            : (pending.column.comment ?? ''),
    );
  }, [pending]);

  if (!kind || !pending) return null;
  const copy = COPY[kind];

  function submit() {
    if (kind === 'rename') onSubmit({ type: 'rename', value });
    else if (kind === 'type') onSubmit({ type: 'changeType', value: { dataType: value, using: null } });
    else if (kind === 'default') onSubmit({ type: 'setDefault', value: value.trim() || null });
    else onSubmit({ type: 'setComment', value: value.trim() || null });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent size="sm">
        <DialogHeader title={copy.title} description={`${pending.column.name} · ${pending.column.dataType}`} />
        <DialogBody>
          <Field label={copy.label} hint={copy.hint}>
            <Input
              autoFocus
              value={value}
              spellCheck={false}
              placeholder={copy.placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={kind === 'rename' && !value.trim()}
            onClick={submit}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
