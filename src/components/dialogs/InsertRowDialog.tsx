import { Plus, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  Checkbox,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Badge, Tooltip } from '@/components/ui/misc';
import { useScope } from '@/hooks/use-catalog';
import { data } from '@/services/api';
import { notify } from '@/utils/notify';
import { validateField, type FieldState } from '@/utils/validation';
import type { ColumnMeta, TableTarget } from '@/types';

export function InsertRowDialog({
  open,
  onOpenChange,
  target,
  columns,
  onInserted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: TableTarget;
  columns: ColumnMeta[];
  onInserted: () => void;
}) {
  const { connectionId, database } = useScope();
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [busy, setBusy] = useState(false);

  const writable = useMemo(() => columns.filter((column) => !column.isGenerated), [columns]);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, FieldState> = {};
    for (const column of writable) {
      initial[column.name] = {
        value: '',
        // Identity columns and columns with a default start out using it.
        useDefault: column.isIdentity || column.default !== null,
        isNull: !column.isIdentity && column.default === null && column.nullable,
      };
    }
    setFields(initial);
  }, [open, writable]);

  const errors = useMemo(() => {
    const found: Record<string, string> = {};
    for (const column of writable) {
      const state = fields[column.name];
      if (!state) continue;
      const message = validateField(column, state);
      if (message) found[column.name] = message;
    }
    return found;
  }, [fields, writable]);

  const hasErrors = Object.keys(errors).length > 0;

  function update(name: string, patch: Partial<FieldState>) {
    setFields((current) => ({ ...current, [name]: { ...current[name]!, ...patch } }));
  }

  async function submit() {
    if (!connectionId || !database) return;
    setBusy(true);
    try {
      await data.insertRow({
        connectionId,
        database,
        request: {
          schema: target.schema,
          table: target.table,
          values: writable.map((column) => {
            const state = fields[column.name]!;
            return {
              column: column.name,
              value: state.useDefault || state.isNull ? null : state.value,
              useDefault: state.useDefault,
            };
          }),
        },
      });
      notify.success('Row inserted');
      onInserted();
      onOpenChange(false);
    } catch (error) {
      notify.failure(error, 'Could not insert the row');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          icon={<Plus />}
          title={`Insert into ${target.schema}.${target.table}`}
          description="Inputs are chosen from each column's PostgreSQL type and validated before the insert runs."
        />
        <DialogBody className="space-y-3.5">
          {writable.map((column) => {
            const state = fields[column.name];
            if (!state) return null;
            const disabled = state.useDefault || state.isNull;

            return (
              <div key={column.name} className="grid grid-cols-[190px_1fr] items-start gap-3">
                <div className="pt-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-ink">
                      {column.name}
                    </span>
                    {column.isPrimaryKey && <Badge variant="caution">PK</Badge>}
                    {!column.nullable && !column.isIdentity && column.default === null && (
                      <span className="text-negative">*</span>
                    )}
                  </div>
                  <p className="truncate font-mono text-[10.5px] text-ink-faint">
                    {column.dataType}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <ValueInput
                    column={column}
                    state={state}
                    disabled={disabled}
                    onChange={(value) =>
                      update(column.name, { value, isNull: false, useDefault: false })
                    }
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    {(column.default !== null || column.isIdentity) && (
                      <Toggle
                        id={`${column.name}-default`}
                        checked={state.useDefault}
                        onChange={(checked) =>
                          update(column.name, { useDefault: checked, isNull: false })
                        }
                        label={
                          <span className="flex items-center gap-1">
                            <Wand2 className="size-3" />
                            Use default
                            {column.default && (
                              <Tooltip content={column.default}>
                                <span className="max-w-[130px] truncate font-mono text-[10.5px] text-ink-faint">
                                  {column.default}
                                </span>
                              </Tooltip>
                            )}
                          </span>
                        }
                      />
                    )}
                    {column.nullable && (
                      <Toggle
                        id={`${column.name}-null`}
                        checked={state.isNull}
                        onChange={(checked) =>
                          update(column.name, { isNull: checked, useDefault: false })
                        }
                        label="NULL"
                      />
                    )}
                  </div>

                  {errors[column.name] && (
                    <p className="text-[11.5px] text-negative">{errors[column.name]}</p>
                  )}
                </div>
              </div>
            );
          })}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={hasErrors}
            loading={busy}
            onClick={() => void submit()}
          >
            Insert row
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="flex select-none items-center gap-1.5 text-[11.5px] text-ink-muted"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}

function ValueInput({
  column,
  state,
  disabled,
  onChange,
}: {
  column: ColumnMeta;
  state: FieldState;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const placeholder = disabled ? (state.useDefault ? 'DEFAULT' : 'NULL') : undefined;

  if (column.typeCategory === 'boolean') {
    return (
      <Select value={state.value || 'true'} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (column.typeCategory === 'enum' && column.enumValues.length > 0) {
    return (
      <Select value={state.value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder ?? 'Choose a value'} />
        </SelectTrigger>
        <SelectContent>
          {column.enumValues.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (column.typeCategory === 'json') {
    return (
      <Textarea
        value={state.value}
        disabled={disabled}
        placeholder={placeholder ?? '{ "key": "value" }'}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-[12px]"
      />
    );
  }

  const inputType =
    column.typeCategory === 'date'
      ? 'date'
      : column.typeCategory === 'time'
        ? 'time'
        : column.typeCategory === 'timestamp'
          ? 'datetime-local'
          : column.typeCategory === 'number'
            ? 'number'
            : 'text';

  return (
    <Field className="space-y-0">
      <Input
        type={inputType}
        step={column.typeCategory === 'timestamp' || column.typeCategory === 'time' ? 1 : undefined}
        value={state.value}
        disabled={disabled}
        placeholder={placeholder ?? hintFor(column)}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function hintFor(column: ColumnMeta): string | undefined {
  switch (column.typeCategory) {
    case 'uuid':
      return '00000000-0000-0000-0000-000000000000';
    case 'array':
      return '{one,two}';
    case 'interval':
      return '1 day 02:00:00';
    case 'network':
      return '192.168.0.1';
    case 'binary':
      return '\\xdeadbeef';
    default:
      return undefined;
  }
}
