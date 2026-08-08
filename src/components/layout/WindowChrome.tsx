import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

const appWindow = getCurrentWindow();

/** Track whether the window is maximised, including changes made outside the app. */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;

    const sync = () => {
      void appWindow
        .isMaximized()
        .then((value) => !cancelled && setMaximized(value))
        .catch(() => undefined);
    };

    sync();
    void appWindow.onResized(sync).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return maximized;
}

/**
 * The window is undecorated so the title bar can carry the connection, the
 * search and the actions instead of a second, empty strip above them. That
 * means the buttons and the resize edges the window manager would have drawn
 * are ours to provide, which is what this file does.
 */
export function WindowControls() {
  const maximized = useMaximized();

  return (
    <div className="flex shrink-0 items-center gap-0.5 pl-1">
      <ControlButton
        label="Minimize"
        onClick={() => void appWindow.minimize()}
        className="hover:bg-[#ffffff14]"
      >
        <Minus className="size-3.5" />
      </ControlButton>

      <ControlButton
        label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void appWindow.toggleMaximize()}
        className="hover:bg-[#ffffff14]"
      >
        {maximized ? <RestoreIcon /> : <Square className="size-3" />}
      </ControlButton>

      <ControlButton
        label="Close"
        onClick={() => void appWindow.close()}
        className="hover:bg-negative hover:text-[#2a0906]"
      >
        <X className="size-4" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-md text-ink-soft transition-colors duration-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Two offset squares, the usual "restore down" glyph. */
function RestoreIcon() {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="1.5" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4.5 4V3.5A1.5 1.5 0 0 1 6 2h5a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 11 10h-.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Edge =
  'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

const EDGES: { edge: Edge; className: string }[] = [
  { edge: 'North', className: 'inset-x-4 top-0 h-[4px] cursor-n-resize' },
  { edge: 'South', className: 'inset-x-4 bottom-0 h-[4px] cursor-s-resize' },
  { edge: 'West', className: 'inset-y-4 left-0 w-[4px] cursor-w-resize' },
  { edge: 'East', className: 'inset-y-4 right-0 w-[4px] cursor-e-resize' },
  { edge: 'NorthWest', className: 'left-0 top-0 size-4 cursor-nw-resize' },
  { edge: 'NorthEast', className: 'right-0 top-0 size-4 cursor-ne-resize' },
  { edge: 'SouthWest', className: 'bottom-0 left-0 size-4 cursor-sw-resize' },
  { edge: 'SouthEast', className: 'bottom-0 right-0 size-4 cursor-se-resize' },
];

/**
 * Grab handles around the window edge. An undecorated window has no frame for
 * the window manager to resize by, so without these the window could only be
 * resized from the maximise button.
 */
export function ResizeEdges() {
  const maximized = useMaximized();

  // A maximised window has no edge to drag, and live handles there would only
  // swallow clicks meant for the content beneath them.
  if (maximized) return null;

  return (
    <>
      {EDGES.map(({ edge, className }) => (
        <div
          key={edge}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            void appWindow.startResizeDragging(edge);
          }}
          className={cn('fixed z-[90] select-none', className)}
        />
      ))}
    </>
  );
}
