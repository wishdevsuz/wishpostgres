import { zodResolver } from '@hookform/resolvers/zod';
import { Database, Eye, EyeOff, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { CheckboxField, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { connections as api } from '@/services/api';
import { useConnectionStore } from '@/state/connection-store';
import { useDialogStore } from '@/state/dialog-store';
import { notify } from '@/utils/notify';
import type { SavedConnection } from '@/types';

const schema = z.object({
  name: z.string().trim().min(1, 'Give the connection a name').max(60),
  host: z.string().trim().min(1, 'A host is required'),
  port: z.coerce.number().int().min(1, 'Port must be 1–65535').max(65535, 'Port must be 1–65535'),
  username: z.string().trim().min(1, 'A username is required'),
  password: z.string(),
  database: z.string().trim().min(1, 'A default database is required'),
  ssl: z.boolean(),
  verifyCertificate: z.boolean(),
  searchPath: z.string(),
});

type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  name: '',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: '',
  database: 'postgres',
  ssl: false,
  verifyCertificate: false,
  searchPath: '',
};

export function ConnectionDialog() {
  const open = useDialogStore((state) => state.open === 'connection');
  const draft = useDialogStore((state) => state.connectionDraft);
  const close = useDialogStore((state) => state.close);
  const refresh = useConnectionStore((state) => state.refresh);
  const connect = useConnectionStore((state) => state.connect);

  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (!open) return;
    setShowPassword(false);
    form.reset(
      draft
        ? {
            name: draft.name,
            host: draft.host,
            port: draft.port,
            username: draft.username,
            password: '',
            database: draft.database,
            ssl: draft.ssl,
            verifyCertificate: draft.verifyCertificate,
            searchPath: draft.searchPath ?? '',
          }
        : DEFAULTS,
    );
  }, [open, draft, form]);

  const ssl = form.watch('ssl');

  function toConnection(values: FormValues): SavedConnection {
    return {
      id: draft?.id ?? crypto.randomUUID(),
      name: values.name.trim(),
      host: values.host.trim(),
      port: values.port,
      username: values.username.trim(),
      database: values.database.trim(),
      ssl: values.ssl,
      verifyCertificate: values.verifyCertificate,
      favorite: draft?.favorite ?? false,
      color: draft?.color ?? null,
      searchPath: values.searchPath.trim() || null,
      statementTimeoutMs: draft?.statementTimeoutMs ?? null,
      createdAt: draft?.createdAt ?? '',
      lastUsedAt: draft?.lastUsedAt ?? null,
      hasPassword: draft?.hasPassword ?? false,
    };
  }

  async function onTest() {
    const values = form.getValues();
    setTesting(true);
    try {
      const server = await api.test(toConnection(values), values.password || undefined);
      notify.success('Connection works', `${server.currentUser} · ${server.currentDatabase}`);
    } catch (error) {
      notify.failure(error, 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await api.save(toConnection(values), values.password || undefined);
      await refresh();
      close();
      notify.success(draft ? 'Connection updated' : 'Connection saved');
      if (!draft) {
        await connect(saved.id).catch((error) => notify.failure(error, `Could not connect to ${saved.name}`));
      }
    } catch (error) {
      notify.failure(error, 'Could not save the connection');
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent size="md">
        <DialogHeader
          icon={<Database />}
          title={draft ? `Edit ${draft.name}` : 'New connection'}
          description="Postgres Lite stores the password in your system keyring when one is available."
        />
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-3.5">
            <Field label="Name" required error={form.formState.errors.name?.message} htmlFor="name">
              <Input id="name" autoFocus placeholder="Production" {...form.register('name')} />
            </Field>

            <div className="grid grid-cols-[1fr_100px] gap-3">
              <Field label="Host" required error={form.formState.errors.host?.message} htmlFor="host">
                <Input id="host" spellCheck={false} {...form.register('host')} />
              </Field>
              <Field label="Port" required error={form.formState.errors.port?.message} htmlFor="port">
                <Input id="port" inputMode="numeric" {...form.register('port')} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Username" required error={form.formState.errors.username?.message} htmlFor="username">
                <Input id="username" spellCheck={false} autoComplete="off" {...form.register('username')} />
              </Field>
              <Field
                label="Password"
                htmlFor="password"
                hint={draft?.hasPassword ? 'Leave blank to keep the stored password' : undefined}
              >
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={draft?.hasPassword ? '••••••••' : ''}
                  {...form.register('password')}
                  trailing={
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconXs"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  }
                />
              </Field>
            </div>

            <Field
              label="Default database"
              required
              error={form.formState.errors.database?.message}
              htmlFor="database"
            >
              <Input id="database" spellCheck={false} {...form.register('database')} />
            </Field>

            <Field
              label="Search path"
              hint="Optional. Applied to every session on this connection, for example: app, public"
              htmlFor="searchPath"
            >
              <Input id="searchPath" spellCheck={false} placeholder="public" {...form.register('searchPath')} />
            </Field>

            <div className="space-y-2.5 rounded-lg border border-line bg-[#ffffff04] p-3">
              <CheckboxField
                id="ssl"
                label="Use SSL"
                hint="Encrypt the connection with TLS."
                checked={ssl}
                onCheckedChange={(value) => form.setValue('ssl', value)}
              />
              <CheckboxField
                id="verifyCertificate"
                label="Verify the server certificate"
                hint="Off accepts self-signed certificates; the traffic is still encrypted."
                disabled={!ssl}
                checked={form.watch('verifyCertificate')}
                onCheckedChange={(value) => form.setValue('verifyCertificate', value)}
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" loading={testing} onClick={() => void onTest()}>
              <Zap />
              Test connection
            </Button>
            <div className="flex-1" />
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
              {draft ? 'Save changes' : 'Save and connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
