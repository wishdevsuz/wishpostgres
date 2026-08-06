import { useQuery } from '@tanstack/react-query';
import { Database, KeyRound, RotateCcw, Settings2 } from 'lucide-react';
import { type ReactNode } from 'react';

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
              <Field label="Rows per page">
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={settings.rowsPerPage}
                  onChange={(event) => update('rowsPerPage', Number(event.target.value) || 100)}
                />
              </Field>
              <Field label="Query timeout (s)" hint="Connection timeout.">
                <Input
                  type="number"
                  min={5}
                  max={3600}
                  value={settings.queryTimeoutSeconds}
                  onChange={(event) =>
                    update('queryTimeoutSeconds', Number(event.target.value) || 60)
                  }
                />
              </Field>
              <Field label="Interface size (px)">
                <Input
                  type="number"
                  min={11}
                  max={18}
                  value={settings.fontSize}
                  onChange={(event) => update('fontSize', Number(event.target.value) || 13)}
                />
              </Field>
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
              <Field label="Statement timeout (ms)" hint="0 disables the server-side timeout.">
                <Input
                  type="number"
                  min={0}
                  value={settings.statementTimeoutMs}
                  onChange={(event) =>
                    update('statementTimeoutMs', Number(event.target.value) || 0)
                  }
                />
              </Field>
            </div>
            <Field
              label="PostgreSQL binary directory"
              hint="Optional. Where pg_dump and psql live, if they are not on PATH."
            >
              <Input
                value={settings.binaryDirectory ?? ''}
                spellCheck={false}
                placeholder="/usr/lib/postgresql/16/bin"
                onChange={(event) => update('binaryDirectory', event.target.value || null)}
              />
            </Field>
            <Field label="Query history limit">
              <Input
                type="number"
                min={10}
                max={100000}
                value={settings.maxHistoryEntries}
                onChange={(event) =>
                  update('maxHistoryEntries', Number(event.target.value) || 1000)
                }
              />
            </Field>
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
          <Button
            variant="ghost"
            onClick={() => {
              void reset().then(() => notify.success('Settings reset to defaults'));
            }}
          >
            <RotateCcw />
            Reset to defaults
          </Button>
          <div className="flex-1" />
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
