import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useShortcuts, type ShortcutHandler } from '@/hooks/use-shortcuts';

function Harness({ shortcuts, enabled }: { shortcuts: ShortcutHandler[]; enabled?: boolean }) {
  useShortcuts(shortcuts, enabled);
  return (
    <div>
      <input data-testid="field" />
      <textarea data-testid="area" />
      <div contentEditable data-testid="editor" />
      <button data-testid="button">press</button>
    </div>
  );
}

function press(
  key: string,
  options: Partial<KeyboardEventInit> & { target?: Element } = {},
): KeyboardEvent {
  const { target, ...init } = options;
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('matching', () => {
  it('fires on a bare key', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'f2', handler }]} />);
    press('F2');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is case insensitive about the key name', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'n', ctrl: true, handler }]} />);
    press('N', { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('requires Ctrl when the shortcut asks for it', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'n', ctrl: true, handler }]} />);
    press('n');
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts Meta in place of Ctrl', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'n', ctrl: true, handler }]} />);
    press('n', { metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not fire a Ctrl shortcut without a modifier', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'n', handler }]} />);
    press('n', { ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('treats an unspecified Shift as "either"', () => {
    // `?` needs Shift on most layouts, so insisting on shift:false made the
    // shortcut impossible to type.
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: '?', handler }]} />);
    press('?', { shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit Shift requirement', () => {
    const withShift = vi.fn();
    const withoutShift = vi.fn();
    render(
      <Harness
        shortcuts={[
          { key: 'f', ctrl: true, shift: true, handler: withShift },
          { key: 'f', ctrl: true, shift: false, handler: withoutShift },
        ]}
      />,
    );

    press('f', { ctrlKey: true, shiftKey: true });
    expect(withShift).toHaveBeenCalledTimes(1);
    expect(withoutShift).not.toHaveBeenCalled();

    press('f', { ctrlKey: true });
    expect(withoutShift).toHaveBeenCalledTimes(1);
    expect(withShift).toHaveBeenCalledTimes(1);
  });

  it('honours the Alt requirement in both directions', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'a', alt: true, handler }]} />);
    press('a');
    expect(handler).not.toHaveBeenCalled();
    press('a', { altKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs only the first matching shortcut', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <Harness
        shortcuts={[
          { key: 'x', handler: first },
          { key: 'x', handler: second },
        ]}
      />,
    );
    press('x');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('prevents the default so the webview does not act on the key too', () => {
    render(<Harness shortcuts={[{ key: 'f2', handler: vi.fn() }]} />);
    expect(press('F2').defaultPrevented).toBe(true);
  });

  it('leaves an unmatched key alone', () => {
    render(<Harness shortcuts={[{ key: 'f2', handler: vi.fn() }]} />);
    expect(press('F3').defaultPrevented).toBe(false);
  });

  it('ignores an auto-repeat so holding a key fires once', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'f2', handler }]} />);
    press('F2', { repeat: true });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('text fields', () => {
  it('does not fire while typing in an input', () => {
    const handler = vi.fn();
    const { getByTestId } = render(<Harness shortcuts={[{ key: 't', ctrl: true, handler }]} />);
    press('t', { ctrlKey: true, target: getByTestId('field') });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire in a textarea or a rich editor either', () => {
    const handler = vi.fn();
    const { getByTestId } = render(<Harness shortcuts={[{ key: 't', ctrl: true, handler }]} />);
    press('t', { ctrlKey: true, target: getByTestId('area') });
    press('t', { ctrlKey: true, target: getByTestId('editor') });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fires in a field when the shortcut opts in', () => {
    const handler = vi.fn();
    const { getByTestId } = render(
      <Harness shortcuts={[{ key: 'k', ctrl: true, allowInFields: true, handler }]} />,
    );
    press('k', { ctrlKey: true, target: getByTestId('field') });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires from a plain element such as a button', () => {
    const handler = vi.fn();
    const { getByTestId } = render(<Harness shortcuts={[{ key: 'f2', handler }]} />);
    press('F2', { target: getByTestId('button') });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('open dialogs', () => {
  it('an open modal takes the keyboard', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'f2', handler }]} />);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);

    press('F2');
    expect(handler).not.toHaveBeenCalled();

    dialog.setAttribute('data-state', 'closed');
    press('F2');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle', () => {
  it('does nothing while disabled', () => {
    const handler = vi.fn();
    render(<Harness shortcuts={[{ key: 'f2', handler }]} enabled={false} />);
    press('F2');
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    const handler = vi.fn();
    const { unmount } = render(<Harness shortcuts={[{ key: 'f2', handler }]} />);
    unmount();
    press('F2');
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses the latest handler without rebinding', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness shortcuts={[{ key: 'f2', handler: first }]} />);
    rerender(<Harness shortcuts={[{ key: 'f2', handler: second }]} />);

    press('F2');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('two mounted sets do not both fire the same key', () => {
    // Ctrl+T used to open two SQL tabs because the shell and the query page
    // each bound it on window.
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Harness shortcuts={[{ key: 't', ctrl: true, handler: outer }]} />
        <Harness shortcuts={[{ key: 't', ctrl: true, handler: inner }]} />
      </>,
    );

    press('t', { ctrlKey: true });
    expect(outer.mock.calls.length + inner.mock.calls.length).toBe(1);
  });
});
