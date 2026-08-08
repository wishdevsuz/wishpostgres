import { TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
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
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** Ask the user to type a word first, used for wide-reaching destructive actions. */
  requireConfirmation?: boolean;
  confirmationWord?: string;
  /** Extra controls shown above the confirmation field, such as a CASCADE toggle. */
  children?: ReactNode;
  onConfirm: () => Promise<void> | void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped('');
      setBusy(false);
    }
  }, [open]);

  const blocked =
    Boolean(requireConfirmation) && typed.trim().toLowerCase() !== confirmationWord.toLowerCase();

  async function confirm() {
    if (blocked || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      notify.failure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader
          title={title}
          description={description}
          icon={destructive ? <TriangleAlert className="text-negative" /> : undefined}
        />
        {(children || requireConfirmation) && (
          <DialogBody className="space-y-3">
            {children}
            {requireConfirmation && (
              <Field label={`Type ${confirmationWord} to continue`}>
                <Input
                  value={typed}
                  autoFocus
                  spellCheck={false}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={confirmationWord}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void confirm();
                    }
                  }}
                />
              </Field>
            )}
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            disabled={blocked}
            loading={busy}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
