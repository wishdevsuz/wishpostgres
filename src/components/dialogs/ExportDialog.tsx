import { save } from '@tauri-apps/plugin-dialog';
import { Download } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { CheckboxField, Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { transfer } from '@/services/api';
import { notify } from '@/utils/notify';
import { formatCount } from '@/utils/format';
import type { ExportFormat, JsonValue } from '@/types';

const FORMATS: { value: ExportFormat; label: string; extension: string; description: string }[] = [
  { value: 'csv', label: 'CSV', extension: 'csv', description: 'Comma separated, one row per line.' },
  { value: 'json', label: 'JSON', extension: 'json', description: 'An array of objects keyed by column.' },
  { value: 'xlsx', label: 'Excel', extension: 'xlsx', description: 'A single sheet with a frozen header row.' },
  {
    value: 'sqlInsert',
    label: 'SQL INSERT',
    extension: 'sql',
    description: 'Batched INSERT statements you can replay anywhere.',
  },
  {
    value: 'sqlCopy',
    label: 'SQL COPY',
    extension: 'sql',
    description: 'A COPY … FROM stdin block, the fastest way to reload.',
  },
];

export function ExportDialog({
  open,
  onOpenChange,
  columns,
  rows,
  defaultName,
  tableName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: string[];
  rows: JsonValue[][];
  defaultName: string;
  tableName?: string;
}) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [includeHeader, setIncludeHeader] = useState(true);
  const [target, setTarget] = useState(tableName ?? defaultName);
  const [busy, setBusy] = useState(false);

  const selected = FORMATS.find((entry) => entry.value === format)!;
  const needsTable = format === 'sqlInsert' || format === 'sqlCopy';

  async function run() {
    const path = await save({
      title: 'Export result',
      defaultPath: `${defaultName.replace(/[^\w.-]+/g, '_')}.${selected.extension}`,
      filters: [{ name: selected.label, extensions: [selected.extension] }],
    });
    if (!path) return;

    setBusy(true);
    try {
      const written = await transfer.exportRows({
        path,
        format,
        columns,
        rows,
        tableName: needsTable ? target : null,
        includeHeader,
      });
      notify.success(`Exported ${formatCount(written)} rows`, path);
      onOpenChange(false);
    } catch (error) {
      notify.failure(error, 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          icon={<Download />}
          title="Export result"
          description={`${formatCount(rows.length)} rows · ${columns.length} columns`}
        />
        <DialogBody className="space-y-3.5">
          <Field label="Format" hint={selected.description}>
            <Select value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {needsTable && (
            <Field label="Target table" hint="Used in the generated statements.">
              <Input value={target} spellCheck={false} onChange={(event) => setTarget(event.target.value)} />
            </Field>
          )}

          {(format === 'csv' || format === 'xlsx') && (
            <CheckboxField
              id="export-header"
              label="Include a header row"
              checked={includeHeader}
              onCheckedChange={setIncludeHeader}
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void run()}>
            Choose file and export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
