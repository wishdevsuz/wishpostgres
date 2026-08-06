import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  CheckboxField,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useScope } from '@/hooks/use-catalog';
import { structure } from '@/services/api';
import { notify } from '@/utils/notify';
import type { TableTarget } from '@/types';

const COMMON_TYPES = [
  'text',
  'character varying(255)',
  'integer',
  'bigint',
  'smallint',
  'numeric(12,2)',
  'double precision',
  'boolean',
  'date',
  'timestamp with time zone',
  'timestamp without time zone',
  'time without time zone',
  'uuid',
  'jsonb',
  'json',
  'bytea',
  'inet',
  'interval',
  'text[]',
  'integer[]',
];

const CUSTOM = '__custom__';

export function AddColumnDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: TableTarget;
}) {
  const { connectionId, database } = useScope();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [preset, setPreset] = useState('text');
  const [customType, setCustomType] = useState('');
  const [nullable, setNullable] = useState(true);
  const [unique, setUnique] = useState(false);
  const [defaultValue, setDefaultValue] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setPreset('text');
    setCustomType('');
    setNullable(true);
    setUnique(false);
    setDefaultValue('');
    setComment('');
  }, [open]);

  const dataType = preset === CUSTOM ? customType : preset;

  const add = useMutation({
    mutationFn: () =>
      structure.addColumn({
        connectionId: connectionId!,
        database: database!,
        request: {
          schema: target.schema,
          table: target.table,
          name: name.trim(),
          dataType: dataType.trim(),
          nullable,
          default: defaultValue.trim() || null,
          unique,
          comment: comment.trim() || null,
        },
      }),
    onSuccess: (statement) => {
      notify.success('Column added', statement);
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (error) => notify.failure(error, 'Could not add the column'),
  });

  const needsDefault = !nullable && !defaultValue.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          icon={<Plus />}
          title="Add column"
          description={`${target.schema}.${target.table}`}
        />
        <DialogBody className="space-y-3.5">
          <Field label="Name" required>
            <Input
              autoFocus
              value={name}
              spellCheck={false}
              placeholder="created_at"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field label="Data type" required>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom…</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {preset === CUSTOM && (
            <Field
              label="Custom type"
              hint="Any type expression PostgreSQL accepts, including domains and enums."
            >
              <Input
                value={customType}
                spellCheck={false}
                placeholder="my_schema.my_enum"
                onChange={(event) => setCustomType(event.target.value)}
              />
            </Field>
          )}

          <Field
            label="Default"
            hint={
              needsDefault
                ? 'A NOT NULL column needs a default when the table already holds rows.'
                : 'Optional expression, for example now() or 0.'
            }
          >
            <Input
              value={defaultValue}
              spellCheck={false}
              placeholder="now()"
              onChange={(event) => setDefaultValue(event.target.value)}
            />
          </Field>

          <Field label="Comment">
            <Input value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>

          <div className="space-y-2.5 rounded-lg border border-line bg-[#ffffff04] p-3">
            <CheckboxField
              id="column-nullable"
              label="Allow NULL"
              checked={nullable}
              onCheckedChange={setNullable}
            />
            <CheckboxField
              id="column-unique"
              label="Unique"
              hint="Adds a unique constraint on the new column."
              checked={unique}
              onCheckedChange={setUnique}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !dataType.trim()}
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            Add column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
