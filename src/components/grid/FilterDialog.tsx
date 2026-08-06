import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/form';
import { EmptyState } from '@/components/ui/misc';
import type { FilterOperator, FilterSpec } from '@/types';

import type { GridColumn } from './types';

const OPERATORS: { value: FilterOperator; label: string; needsValue: boolean }[] = [
  { value: 'equals', label: 'equals', needsValue: true },
  { value: 'notEquals', label: 'does not equal', needsValue: true },
  { value: 'greaterThan', label: 'greater than', needsValue: true },
  { value: 'greaterOrEqual', label: 'greater or equal', needsValue: true },
  { value: 'lessThan', label: 'less than', needsValue: true },
  { value: 'lessOrEqual', label: 'less or equal', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'notContains', label: 'does not contain', needsValue: true },
  { value: 'startsWith', label: 'starts with', needsValue: true },
  { value: 'endsWith', label: 'ends with', needsValue: true },
  { value: 'isNull', label: 'is NULL', needsValue: false },
  { value: 'isNotNull', label: 'is not NULL', needsValue: false },
];

export function FilterDialog({
  open,
  onOpenChange,
  columns,
  filters,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: GridColumn[];
  filters: FilterSpec[];
  onApply: (filters: FilterSpec[]) => void;
}) {
  const [draft, setDraft] = useState<FilterSpec[]>(filters);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  function update(index: number, patch: Partial<FilterSpec>) {
    setDraft((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title="Filters"
          description="Every condition is combined with AND and sent as a bound parameter."
        />
        <DialogBody className="space-y-2">
          {draft.length === 0 ? (
            <EmptyState
              title="No filters"
              description="Add a condition to narrow the rows this table returns."
              className="py-8"
            />
          ) : (
            draft.map((filter, index) => {
              const operator = OPERATORS.find((entry) => entry.value === filter.operator);
              return (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-[11px] uppercase text-ink-faint">
                    {index === 0 ? 'where' : 'and'}
                  </span>

                  <Select
                    value={filter.column}
                    onValueChange={(column) => update(index, { column })}
                  >
                    <SelectTrigger className="w-[190px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((column) => (
                        <SelectItem key={column.name} value={column.name}>
                          {column.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={filter.operator}
                    onValueChange={(value) => update(index, { operator: value as FilterOperator })}
                  >
                    <SelectTrigger className="w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((entry) => (
                        <SelectItem key={entry.value} value={entry.value}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={filter.value ?? ''}
                    disabled={!operator?.needsValue}
                    placeholder={operator?.needsValue ? 'Value' : '—'}
                    onChange={(event) => update(index, { value: event.target.value })}
                    className="flex-1"
                    spellCheck={false}
                  />

                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label="Remove filter"
                    onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })
          )}

          <Button
            variant="subtle"
            size="sm"
            disabled={columns.length === 0}
            onClick={() =>
              setDraft((current) => [
                ...current,
                { column: columns[0]?.name ?? '', operator: 'equals', value: '' },
              ])
            }
          >
            <Plus /> Add condition
          </Button>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft([])} disabled={draft.length === 0}>
            Clear all
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(
                draft.filter((entry) => {
                  const operator = OPERATORS.find((item) => item.value === entry.operator);
                  return entry.column && (!operator?.needsValue || (entry.value ?? '') !== '');
                }),
              );
              onOpenChange(false);
            }}
          >
            Apply filters
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
