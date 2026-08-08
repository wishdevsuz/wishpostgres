import { useQuery, useQueryClient } from '@tanstack/react-query';
import { open as openDirectory } from '@tauri-apps/plugin-dialog';
import { Database, FolderOpen, KeyRound, RotateCcw, Settings2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Badge, Separator } from '@/components/ui/misc';
import { connections } from '@/services/api';
import { useDialogStore } from '@/state/dialog-store';
import { useSettingsStore } from '@/state/settings-store';
import { notify } from '@/utils/notify';
import type { AppSettings } from '@/types';

export function SettingsDialog() {
  const open = useDialogStore((state) => state.open === 'settings');
  const close = useDialogStore((state) => state.close);
  const settings = useSettingsStore((state) => state.settings);
  const save = useSettingsStore((state) => state.save);
  const reset = useSettingsStore((state) => state.reset);

  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState(false);

  const info = useQuery({
    queryKey: ['storage-info'],
    queryFn: connections.storageInfo,
    enabled: open,
    staleTime: 60_000,
  });

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    void save({ [key]: value } as Partial<AppSettings>).catch((error) =>
      notify.failure(error, 'Could not save settings'),
    );
  }

  async function browseForBinaries() {
    try {
      const picked = await openDirectory({
        title: 'Where pg_dump and psql live',
        directory: true,
        multiple: false,
      });
      if (typeof picked !== 'string') return;
      update('binaryDirectory', picked);
      void queryClient.invalidateQueries({ queryKey: ['storage-info'] });
    } catch (error) {
      notify.failure(error, 'Could not open the folder picker');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent size="lg">
        <DialogHeader
          icon={<Settings2 />}
          title="Settings"
          description="Changes are saved as you make them."
        />
        <DialogBody className="space-y-5">
          <Section icon={<Settings2 />} title="Application">
            <Toggle
              label="Auto reconnect"
              hint="Re-open a dropped session automatically on the next query."
              checked={settings.autoReconnect}
              onChange={(value) => update('autoReconnect', value)}
            />
            <Toggle
              label="Open the last connection on launch"
              checked={settings.openLastConnection}
              onChange={(value) => update('openLastConnection', value)}
            />
            <Toggle
              label="Animations"
              hint="Turn off to remove every transition and motion effect."
              checked={settings.animations}
              onChange={(value) => update('animations', value)}
            />
            <Toggle
              label="Confirm before deleting"
              hint="Ask for typed confirmation when deleting many rows."
              checked={settings.confirmBeforeDelete}
              onChange={(value) => update('confirmBeforeDelete', value)}
            />
            <Toggle
              label="Check for updates"
              checked={settings.checkUpdates}
              onChange={(value) => update('checkUpdates', value)}
            />

            <div className="grid grid-cols-3 gap-3 pt-1">
              <NumberField
                label="Rows per page"
                min={1}
                max={10000}
                fallback={100}
                value={settings.rowsPerPage}
                onCommit={(value) => update('rowsPerPage', value)}
              />
              <NumberField
                label="Query timeout (s)"
                hint="How long one statement may run."
                min={5}
                max={3600}
                fallback={60}
                value={settings.queryTimeoutSeconds}
                onCommit={(value) => update('queryTimeoutSeconds', value)}
              />
              <NumberField
                label="Interface size (px)"
                hint="Scales the whole window."
                min={11}
                max={18}
                fallback={13}
                value={settings.fontSize}
                onCommit={(value) => update('fontSize', value)}
              />
            </div>
          </Section>

          <Separator />

          <Section icon={<Database />} title="Database">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default schema" hint="Placed first on the search path.">
                <Input
                  value={settings.defaultSchema}
                  spellCheck={false}
                  onChange={(event) => update('defaultSchema', event.target.value)}
                />
              </Field>
              <NumberField
                label="Statement timeout (ms)"
                hint="0 disables the server-side timeout."
                min={0}
                max={86_400_000}
                fallback={0}
                allowZero
                value={settings.statementTimeoutMs}
                onCommit={(value) => update('statementTimeoutMs', value)}
              />
            </div>
            <Field
              label="PostgreSQL binary directory"
              hint="Optional. Where pg_dump and psql live, if they are not on PATH."
            >
              <div className="flex items-center gap-2">
                <Input
                  value={settings.binaryDirectory ?? ''}
                  spellCheck={false}
                  placeholder="/usr/lib/postgresql/16/bin"
                  onChange={(event) => update('binaryDirectory', event.target.value || null)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void browseForBinaries()}
                >
                  <FolderOpen />
                  Browse…
                </Button>
              </div>
            </Field>
            <NumberField
              label="Query history limit"
              hint="Older entries are dropped once the list is longer than this."
              min={10}
              max={100000}
              fallback={1000}
              value={settings.maxHistoryEntries}
              onCommit={(value) => update('maxHistoryEntries', value)}
            />
          </Section>

          <Separator />

          <Section icon={<KeyRound />} title="Storage">
            <dl className="space-y-2 text-[12px]">
              <Row label="Configuration">
                <code className="font-mono text-[11.5px] text-ink-soft">
                  {info.data?.configDirectory ?? '…'}
                </code>
              </Row>
              <Row label="Passwords">
                {info.data ? (
                  info.data.secretBackend === 'keyring' ? (
                    <Badge variant="positive" size="md">
                      System keyring
                    </Badge>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Badge variant="caution" size="md">
                        Encrypted file
                      </Badge>
                      <span className="text-ink-faint">
                        No keyring was reachable on this session.
                      </span>
                    </span>
                  )
                ) : (
                  '…'
                )}
              </Row>
              <Row label="pg_dump">
                {info.data?.pgDumpVersion ?? (
                  <span className="text-caution">Not found — backups are unavailable</span>
                )}
              </Row>
              <Row label="psql">
                {info.data?.psqlVersion ?? (
                  <span className="text-caution">Not found — restores are unavailable</span>
                )}
              </Row>
            </dl>
          </Section>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setResetting(true)}>
            <RotateCcw />
            Reset to defaults
          </Button>
          <div className="flex-1" />
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title="Reset every setting?"
        description="All preferences go back to their defaults. Connections, saved queries and history are untouched."
        confirmLabel="Reset settings"
        onConfirm={async () => {
          await reset();
          notify.success('Settings reset to defaults');
        }}
      />
    </Dialog>
  );
}

/**
 * A numeric preference that only writes once the value is complete. Committing
 * on every keystroke made the field fight the user: clearing it to retype
 * snapped straight back to the fallback.
 */
function NumberField({
  label,
  hint,
  min,
  max,
  fallback,
  allowZero,
  value,
  onCommit,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  fallback: number;
  allowZero?: boolean;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const parsed = Number(draft);
    const valid = draft.trim() !== '' && Number.isFinite(parsed) && (allowZero || parsed !== 0);
    const next = valid ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_svg]:size-3.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-[12.5px] text-ink">{label}</p>
        {hint && <p className="text-[11.5px] leading-snug text-ink-faint">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ink-soft">{children}</dd>
    </div>
  );
}
