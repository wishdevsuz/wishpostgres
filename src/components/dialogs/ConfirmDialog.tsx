import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/form';
import { notify } from '@/utils/notify';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  requireConfirmation,
  confirmationWord = 'confirm',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Ask the user to type a word first, used for wide-reaching destructive actions. */
  requireConfirmation?: boolean;
  confirmationWord?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const blocked = requireConfirmation && typed.trim().toLowerCase() !== confirmationWord.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title={title}
          description={description}
          icon={destructive ? <TriangleAlert className="text-negative" /> : undefined}
        />
        {requireConfirmation && (
          <DialogBody>
            <Field label={`Type ${confirmationWord} to continue`}>
              <Input
                value={typed}
                autoFocus
                spellCheck={false}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={confirmationWord}
              />
            </Field>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            disabled={blocked}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (error) {
                notify.failure(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
