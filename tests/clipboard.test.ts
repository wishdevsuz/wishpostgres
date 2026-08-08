import { describe, expect, it } from 'vitest';

import { toClipboardTable } from '@/hooks/use-clipboard';

describe('toClipboardTable', () => {
  it('joins cells with tabs and rows with newlines, the format spreadsheets paste', () => {
    expect(
      toClipboardTable([
        ['1', 'ann'],
        ['2', 'bo'],
      ]),
    ).toBe('1\tann\n2\tbo');
  });

  it('puts the header first when one is given', () => {
    expect(toClipboardTable([['1']], ['id'])).toBe('id\n1');
  });

  it('handles a single cell', () => {
    expect(toClipboardTable([['solo']])).toBe('solo');
  });

  it('handles no rows at all', () => {
    expect(toClipboardTable([])).toBe('');
    expect(toClipboardTable([], ['id'])).toBe('id');
  });

  it('quotes a cell containing a tab, so the columns do not shift', () => {
    expect(toClipboardTable([['a\tb']])).toBe('"a\tb"');
  });

  it('quotes a cell containing a newline', () => {
    expect(toClipboardTable([['line1\nline2']])).toBe('"line1\nline2"');
  });

  it('doubles an embedded quote and wraps the cell', () => {
    expect(toClipboardTable([['say "hi"']])).toBe('"say ""hi"""');
  });

  it('leaves ordinary text unquoted', () => {
    expect(toClipboardTable([["it's fine, really"]])).toBe("it's fine, really");
  });

  it('quotes only the cells that need it', () => {
    expect(toClipboardTable([['plain', 'a\tb']])).toBe('plain\t"a\tb"');
  });

  it('keeps an empty cell as an empty field', () => {
    expect(toClipboardTable([['a', '', 'c']])).toBe('a\t\tc');
  });

  it('keeps ragged rows as they are rather than padding them', () => {
    expect(toClipboardTable([['a', 'b'], ['c']])).toBe('a\tb\nc');
  });
});
