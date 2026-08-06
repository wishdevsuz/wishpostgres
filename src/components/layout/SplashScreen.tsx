import { Database } from 'lucide-react';

import { cn } from '@/lib/utils';

export type BootStage = 'settings' | 'workspace' | 'connections' | 'connecting' | 'ready';

const STAGES: { key: BootStage; label: string }[] = [
  { key: 'settings', label: 'Loading preferences' },
  { key: 'workspace', label: 'Restoring workspace' },
  { key: 'connections', label: 'Reading saved connections' },
  { key: 'connecting', label: 'Opening last connection' },
];

/**
 * Shown while the app restores its persisted state and reconnects. It stays on
 * screen until the work is genuinely finished, then fades out, so the first
 * frame the user interacts with is already populated.
 */
export function SplashScreen({
  stage,
  detail,
  leaving,
}: {
  stage: BootStage;
  detail?: string;
  leaving: boolean;
}) {
  const index = STAGES.findIndex((entry) => entry.key === stage);
  const current = index === -1 ? STAGES.length : index;
  const percent = ((current + (stage === 'ready' ? 1 : 0.35)) / STAGES.length) * 100;

  return (
    <div
      aria-hidden={leaving}
      className={cn(
        'fixed inset-0 z-[100] flex flex-col items-center justify-center bg-canvas transition-opacity duration-300 ease-[var(--ease-out-soft)]',
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
    >
      <div className="flex flex-col items-center gap-5">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-accent/25 blur-2xl" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl bg-gradient-to-b from-accent to-[#3d80d4] text-[#08172b]">
            <Database className="size-7" />
          </div>
        </div>

        <div className="space-y-1 text-center">
          <p className="text-[15px] font-semibold tracking-[-0.02em] text-ink">WishPostgres</p>
          <p className="h-4 text-[12px] text-ink-muted" role="status" aria-live="polite">
            {detail ?? STAGES[current]?.label ?? 'Ready'}
          </p>
        </div>

        <div className="h-[3px] w-[180px] overflow-hidden rounded-full bg-[#ffffff0d]">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-out-soft)]"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
