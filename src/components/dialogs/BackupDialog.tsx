import { listen } from '@tauri-apps/api/event';
import { open as openFile, save } from '@tauri-apps/plugin-dialog';
import { DownloadCloud, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { CheckboxField, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/misc';
import { transfer } from '@/services/api';
import { useConnectionStore } from '@/state/connection-store';
import { useDialogStore } from '@/state/dialog-store';
import { notify } from '@/utils/notify';
import { formatBytes, formatDuration } from '@/utils/format';
import type { TransferProgress } from '@/types';

const PROGRESS_EVENT = 'transfer://progress';

/** Subscribe to backend progress events for one operation token. */
function useProgress(token: string, active: boolean) {
  const [progress, setProgress] = useState<TransferProgress | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(null);
      return;
    }
    let dispose: (() => void) | undefined;
    void listen<TransferProgress>(PROGRESS_EVENT, (event) => {
      if (event.payload.token === token) setProgress(event.payload);
    }).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, [token, active]);

  return progress;
}

export function BackupDialog() {
  const open = useDialogStore((state) => state.open === 'backup');
  const close = useDialogStore((state) => state.close);
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);

  const [token] = useState(() => crypto.randomUUID());
  const [path, setPath] = useState('');
  const [schemaOnly, setSchemaOnly] = useState(false);
  const [dataOnly, setDataOnly] = useState(false);
  const [includeDrop, setIncludeDrop] = useState(true);
  const [includeCreate, setIncludeCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const progress = useProgress(token, busy);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setPath('');
    }
  }, [open]);

  async function choose() {
    const picked = await save({
      title: 'Save database dump',
      defaultPath: `${database ?? 'database'}-${new Date().toISOString().slice(0, 10)}.sql`,
      filters: [{ name: 'SQL dump', extensions: ['sql'] }],
    });
    if (picked) setPath(picked);
  }

  async function run() {
    if (!connectionId || !database || !path) return;
    setBusy(true);
    try {
      const outcome = await transfer.backup({
        connectionId,
        token,
        request: {
          database,
          path,
          schemaOnly,
          dataOnly,
          includeDrop,
          includeCreate,
          schemas: [],
          tables: [],
          binaryDirectory: null,
        },
      });
      notify.success(
        'Backup complete',
        `${formatBytes(outcome.bytes)} in ${formatDuration(outcome.durationMs)}`,
      );
      close();
    } catch (error) {
      notify.failure(error, 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent size="md">
        <DialogHeader
          icon={<DownloadCloud />}
          title={`Back up ${database ?? ''}`}
          description="Runs pg_dump and writes a plain SQL file you can restore from anywhere."
        />
        <DialogBody className="space-y-3.5">
          <div className="flex items-end gap-2">
            <Field label="Destination" className="flex-1">
              <Input
                readOnly
                value={path}
                placeholder="No file chosen"
                onClick={() => void choose()}
              />
            </Field>
            <Button variant="secondary" onClick={() => void choose()}>
              Choose…
            </Button>
          </div>

          <div className="space-y-2.5 rounded-lg border border-line bg-[#ffffff04] p-3">
            <CheckboxField
              id="backup-schema-only"
              label="Schema only"
              hint="Structure without any rows."
              checked={schemaOnly}
              onCheckedChange={(checked) => {
                setSchemaOnly(checked);
                if (checked) setDataOnly(false);
              }}
            />
            <CheckboxField
              id="backup-data-only"
              label="Data only"
              hint="Rows without any CREATE statements."
              checked={dataOnly}
              onCheckedChange={(checked) => {
                setDataOnly(checked);
                if (checked) setSchemaOnly(false);
              }}
            />
            <CheckboxField
              id="backup-drop"
              label="Include DROP statements"
              hint="Adds DROP … IF EXISTS so the dump can replace existing objects."
              disabled={dataOnly}
              checked={includeDrop}
              onCheckedChange={setIncludeDrop}
            />
            <CheckboxField
              id="backup-create"
              label="Include CREATE DATABASE"
              checked={includeCreate}
              onCheckedChange={setIncludeCreate}
            />
          </div>

          {busy && (
            <div className="space-y-1.5">
              <ProgressBar value={progress?.percent ?? null} />
              <p className="truncate text-[11.5px] text-ink-muted">
                {progress?.message ?? 'Starting pg_dump…'}
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!path} loading={busy} onClick={() => void run()}>
            Start backup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RestoreDialog() {
  const open = useDialogStore((state) => state.open === 'restore');
  const close = useDialogStore((state) => state.close);
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);

  const [token] = useState(() => crypto.randomUUID());
  const [path, setPath] = useState('');
  const [stopOnError, setStopOnError] = useState(true);
  const [singleTransaction, setSingleTransaction] = useState(true);
  const [busy, setBusy] = useState(false);
  const progress = useProgress(token, busy);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setPath('');
    }
  }, [open]);

  async function choose() {
    const picked = await openFile({
      title: 'Choose a SQL dump',
      multiple: false,
      filters: [
        { name: 'SQL dump', extensions: ['sql'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (typeof picked === 'string') setPath(picked);
  }

  async function run() {
    if (!connectionId || !database || !path) return;
    setBusy(true);
    try {
      const outcome = await transfer.restore({
        connectionId,
        token,
        request: { database, path, stopOnError, singleTransaction, binaryDirectory: null },
      });
      notify.success(
        'Restore complete',
        `${formatBytes(outcome.bytes)} in ${formatDuration(outcome.durationMs)}`,
      );
      close();
    } catch (error) {
      notify.failure(error, 'Restore failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent size="md">
        <DialogHeader
          icon={<UploadCloud />}
          title={`Restore into ${database ?? ''}`}
          description="Streams the dump through psql. Existing objects with the same name may be replaced."
        />
        <DialogBody className="space-y-3.5">
          <div className="flex items-end gap-2">
            <Field label="Dump file" className="flex-1">
              <Input
                readOnly
                value={path}
                placeholder="No file chosen"
                onClick={() => void choose()}
              />
            </Field>
            <Button variant="secondary" onClick={() => void choose()}>
              Choose…
            </Button>
          </div>

          <div className="space-y-2.5 rounded-lg border border-line bg-[#ffffff04] p-3">
            <CheckboxField
              id="restore-stop"
              label="Stop on the first error"
              checked={stopOnError}
              onCheckedChange={setStopOnError}
            />
            <CheckboxField
              id="restore-transaction"
              label="Run inside one transaction"
              hint="All or nothing: a failure rolls the whole restore back."
              checked={singleTransaction}
              onCheckedChange={setSingleTransaction}
            />
          </div>

          {busy && (
            <div className="space-y-1.5">
              <ProgressBar value={progress?.percent ?? null} />
              <p className="truncate text-[11.5px] text-ink-muted">
                {progress?.message ?? 'Starting psql…'}
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!path} loading={busy} onClick={() => void run()}>
            Start restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
