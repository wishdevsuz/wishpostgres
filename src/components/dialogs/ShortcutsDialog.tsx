import { Keyboard } from 'lucide-react';

import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/misc';
import { SHORTCUT_GROUPS } from '@/constants/shortcuts';
import { useDialogStore } from '@/state/dialog-store';

export function ShortcutsDialog() {
  const open = useDialogStore((state) => state.open === 'shortcuts');
  const close = useDialogStore((state) => state.close);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent size="lg">
        <DialogHeader icon={<Keyboard />} title="Keyboard shortcuts" />
        <DialogBody className="grid gap-6 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                {group.title}
              </h3>
              <dl className="space-y-1">
                {group.items.map((item, index) => (
                  <div
                    key={`${item.label}-${item.keys.join('+')}`}
                    className="flex items-center justify-between gap-3 py-0.5"
                  >
                    <dt className="text-[12.5px] text-ink-soft">
                      {/* A second binding for the same action reads as "or". */}
                      {index > 0 && group.items[index - 1]?.label === item.label ? '' : item.label}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
