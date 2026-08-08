import { open as openFile } from '@tauri-apps/plugin-dialog';
import { ArrowRight, FileUp, Upload } from 'lucide-react';
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
  CheckboxField,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useScope } from '@/hooks/use-catalog';
import { transfer } from '@/services/api';
import { notify } from '@/utils/notify';
import { formatCount } from '@/utils/format';
import type { ColumnMeta, ImportPreview, TableTarget } from '@/types';

const SKIP = '__skip__';

export function ImportDialog({
  open,
  onOpenChange,
  target,
  columns,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: TableTarget;
  columns: ColumnMeta[];
  onImported: () => void;
}) {
  const { connectionId, database } = useScope();
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [delimiter, setDelimiter] = useState(',');
  const [truncateFirst, setTruncateFirst] = useState(false);
  const [stopOnError, setStopOnError] = useState(true);
  const [nullLiteral, setNullLiteral] = useState('');
  const [busy, setBusy] = useState(false);

  const writable = useMemo(() => columns.filter((column) => !column.isGenerated), [columns]);

  // Every opening starts from a clean slate; keeping the previous file's mapping
  // silently pointed the import at columns the new file does not have.
  useEffect(() => {
    if (open) return;
    setPath(null);
    setPreview(null);
    setMapping({});
    setTruncateFirst(false);
    setBusy(false);
  }, [open]);

  async function pickFile() {
    const picked = await openFile({
      title: 'Choose a file to import',
      multiple: false,
      filters: [
        { name: 'Data files', extensions: ['csv', 'tsv', 'txt', 'json', 'xlsx', 'xls', 'ods'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (typeof picked !== 'string') return;

    // A .tsv is tab separated by definition; starting on a comma would parse
    // the whole file as a single column.
    const separator = /\.tsv$/i.test(picked) ? '\t' : delimiter;
    setPath(picked);
    setDelimiter(separator);
    await loadPreview(picked, hasHeader, separator);
  }

  async function loadPreview(file: string, header: boolean, separator: string) {
    setBusy(true);
    try {
      const result = await transfer.previewImport(file, header, separator || ',');
      setPreview(result);
      // Auto-map on exact then case-insensitive name matches. Generated columns
      // are skipped: PostgreSQL refuses to be given a value for them.
      const auto: Record<string, string> = {};
      for (const column of writable) {
        const match =
          result.columns.find((name) => name === column.name) ??
          result.columns.find((name) => name.toLowerCase() === column.name.toLowerCase());
        auto[column.name] = match ?? SKIP;
      }
      setMapping(auto);
    } catch (error) {
      notify.failure(error, 'Could not read that file');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!path || !connectionId || !database) return;
    const pairs = Object.entries(mapping)
      .filter(([, source]) => source !== SKIP)
      .map(([targetColumn, source]) => ({ source, target: targetColumn }));

    if (pairs.length === 0) {
      notify.warn('Map at least one column before importing');
      return;
    }

    setBusy(true);
    try {
      const outcome = await transfer.importRows({
        connectionId,
        database,
        request: {
          path,
          schema: target.schema,
          table: target.table,
          mapping: pairs,
          hasHeader,
          delimiter: delimiter || ',',
          truncateFirst,
          stopOnError,
          nullLiteral: nullLiteral || null,
        },
      });

      if (outcome.failed > 0) {
        notify.warn(
          `Imported ${formatCount(outcome.inserted)} rows, ${formatCount(outcome.failed)} failed`,
          outcome.errors[0],
        );
      } else {
        notify.success(`Imported ${formatCount(outcome.inserted)} rows`);
      }
      onImported();
      onOpenChange(false);
    } catch (error) {
      notify.failure(error, 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  const isDelimited = path ? /\.(csv|tsv|txt)$/i.test(path) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader
          icon={<Upload />}
          title={`Import into ${target.schema}.${target.table}`}
          description="Choose a CSV, JSON or Excel file, map its columns, then review the preview before writing."
        />
        <DialogBody className="space-y-4">
          <div className="flex items-end gap-2">
            <Field label="File" className="flex-1">
              <Input
                readOnly
                value={path ?? ''}
                placeholder="No file chosen"
                className="cursor-default"
                onClick={() => void pickFile()}
              />
            </Field>
            <Button variant="secondary" onClick={() => void pickFile()}>
              <FileUp />
              Choose file
            </Button>
          </div>

          {path && (
            <div className="flex flex-wrap items-center gap-4">
              <CheckboxField
                id="import-header"
                label="First row is a header"
                checked={hasHeader}
                onCheckedChange={(checked) => {
                  setHasHeader(checked);
                  void loadPreview(path, checked, delimiter);
                }}
              />
              {isDelimited && (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-ink-soft">Delimiter</span>
                  <Select
                    value={delimiter}
                    onValueChange={(value) => {
                      setDelimiter(value);
                      void loadPreview(path, hasHeader, value);
                    }}
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value=",">Comma</SelectItem>
                      <SelectItem value=";">Semicolon</SelectItem>
                      {/* A real tab: `"\t"` in JSX is a literal backslash. */}
                      <SelectItem value={'\t'}>Tab</SelectItem>
                      <SelectItem value="|">Pipe</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Field label="Treat as NULL" className="w-[150px] space-y-0">
                <Input
                  value={nullLiteral}
                  placeholder="(empty cells)"
                  onChange={(event) => setNullLiteral(event.target.value)}
                />
              </Field>
            </div>
          )}

          {preview && (
            <>
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
                  Column mapping
                </h3>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {writable.map((column) => (
                    <div key={column.name} className="flex items-center gap-2">
                      <div className="flex w-[150px] shrink-0 items-center gap-1.5">
                        <span className="truncate text-[12.5px]">{column.name}</span>
                        {!column.nullable && column.default === null && (
                          <Badge variant="caution">required</Badge>
                        )}
                      </div>
                      <ArrowRight className="size-3 shrink-0 text-ink-faint" />
                      <Select
                        value={mapping[column.name] ?? SKIP}
                        onValueChange={(value) =>
                          setMapping((current) => ({ ...current, [column.name]: value }))
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP}>Skip this column</SelectItem>
                          {preview.columns.map((source) => (
                            <SelectItem key={source} value={source}>
                              {source}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
                  Preview
                  <span className="font-normal normal-case tracking-normal text-ink-faint">
                    {formatCount(preview.totalRows)} rows in the file
                  </span>
                </h3>
                <div className="max-h-[220px] overflow-auto rounded-lg border border-line">
                  <table className="w-full border-collapse text-[12px]">
                    <thead className="sticky top-0 bg-elevated">
                      <tr>
                        {preview.columns.map((column) => (
                          <th
                            key={column}
                            className="border-b border-line px-2 py-1.5 text-left font-semibold text-ink-soft"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 20).map((row, index) => (
                        <tr key={index} className={index % 2 ? 'bg-[#ffffff03]' : undefined}>
                          {preview.columns.map((_, cell) => (
                            <td
                              key={cell}
                              className="truncate border-b border-line/50 px-2 py-1 text-ink-soft"
                            >
                              {row[cell] ?? <span className="italic text-ink-faint">NULL</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="flex flex-wrap gap-5">
                <CheckboxField
                  id="import-truncate"
                  label="Empty the table first"
                  hint="Runs TRUNCATE before inserting."
                  checked={truncateFirst}
                  onCheckedChange={setTruncateFirst}
                />
                <CheckboxField
                  id="import-stop"
                  label="Stop on the first error"
                  hint="Off keeps going and reports the failed batches."
                  checked={stopOnError}
                  onCheckedChange={setStopOnError}
                />
              </div>
            </>
          )}

          {!path && (
            <EmptyState
              icon={<FileUp />}
              title="No file chosen"
              description="Supported formats: CSV, TSV, JSON and Excel workbooks."
              className="py-10"
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!preview} loading={busy} onClick={() => void run()}>
            Import rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
