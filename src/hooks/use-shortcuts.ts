import { useEffect, useRef } from 'react';

export interface ShortcutHandler {
  /** Lower-case key name, matching `KeyboardEvent.key`. */
  key: string;
  ctrl?: boolean;
  /**
   * Leave undefined to match with or without Shift. That matters for keys such
   * as `?` which can only be typed with Shift held on most layouts.
   */
  shift?: boolean;
  alt?: boolean;
  /** Run even while focus is inside an input, textarea or editor. */
  allowInFields?: boolean;
  handler: (event: KeyboardEvent) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * An open modal owns the keyboard. Without this an app-level shortcut such as
 * F2 or Ctrl+T would fire behind a dialog the user is still filling in.
 */
function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

/**
 * Register global keyboard shortcuts. Handlers are held in a ref so callers can
 * pass fresh closures without re-binding the listener on every render.
 */
export function useShortcuts(shortcuts: ShortcutHandler[], enabled = true) {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;
      if (isModalOpen()) return;
      const key = event.key.toLowerCase();
      const editable = isEditableTarget(event.target);

      for (const shortcut of latest.current) {
        if (shortcut.key !== key) continue;
        if (Boolean(shortcut.ctrl) !== (event.ctrlKey || event.metaKey)) continue;
        if (shortcut.shift !== undefined && shortcut.shift !== event.shiftKey) continue;
        if (Boolean(shortcut.alt) !== event.altKey) continue;
        if (editable && !shortcut.allowInFields) continue;

        event.preventDefault();
        // Several components register their own window listener, so the plain
        // `stopPropagation` would still let a second listener fire the same
        // shortcut twice.
        event.stopImmediatePropagation();
        shortcut.handler(event);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
