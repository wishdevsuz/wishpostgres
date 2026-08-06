import { Copy, Lightbulb, OctagonAlert, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/misc';
import { useClipboard } from '@/hooks/use-clipboard';
import { useDialogStore } from '@/state/dialog-store';
import type { ErrorReport } from '@/types';

export function ErrorDialog() {
  const error = useDialogStore((state) => state.error);
  const dismiss = useDialogStore((state) => state.dismissError);
  const copy = useClipboard();

  return (
    <Dialog open={Boolean(error)} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent size="md">
        {error && (
          <>
            <DialogHeader
              icon={<OctagonAlert className="text-negative" />}
              title={<span className="text-negative">{titleFor(error)}</span>}
              description={error.message}
            />
            <DialogBody className="space-y-3">
              {(error.sqlstate || error.position !== null) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {error.sqlstate && (
                    <Badge variant="negative" size="md">
                      SQLSTATE {error.sqlstate}
                    </Badge>
                  )}
                  {error.position !== null && (
                    <Badge variant="outline" size="md">
                      at character {error.position}
                    </Badge>
                  )}
                </div>
              )}

              {error.reason && (
                <Panel icon={<Lightbulb className="text-caution" />} title="Likely cause">
                  {error.reason}
                </Panel>
              )}

              {error.suggestion && (
                <Panel icon={<Wrench className="text-accent" />} title="Suggested fix">
                  {error.suggestion}
                </Panel>
              )}

              {error.detail && <Detail label="Detail" value={error.detail} />}
              {error.hint && <Detail label="Server hint" value={error.hint} />}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => void copy(asText(error), 'Error copied')}>
                <Copy />
                Copy error
              </Button>
              <div className="flex-1" />
              <Button variant="primary" onClick={dismiss}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-[#ffffff05] p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted [&_svg]:size-3.5">
        {icon}
        {title}
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
        {label}
      </p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-soft">
        {value}
      </pre>
    </div>
  );
}

function titleFor(error: ErrorReport): string {
  switch (error.kind) {
    case 'postgres':
      return 'PostgreSQL rejected the statement';
    case 'connection':
      return 'Could not reach the server';
    case 'tls':
      return 'TLS handshake failed';
    case 'invalid':
      return 'Invalid request';
    case 'secret':
      return 'Credential store problem';
    case 'io':
      return 'File error';
    default:
      return 'Something went wrong';
  }
}

function asText(error: ErrorReport): string {
  return [
    error.message,
    error.sqlstate && `SQLSTATE: ${error.sqlstate}`,
    error.detail && `Detail: ${error.detail}`,
    error.hint && `Hint: ${error.hint}`,
    error.position !== null && `Position: ${error.position}`,
    error.reason && `Likely cause: ${error.reason}`,
    error.suggestion && `Suggested fix: ${error.suggestion}`,
  ]
    .filter(Boolean)
    .join('\n');
}
