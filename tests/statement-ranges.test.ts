import { describe, expect, it } from 'vitest';

import { statementRanges } from '@/components/sql/statements';

/** The statement text at each range, which is what "Run" ends up executing. */
function pieces(doc: string): string[] {
  return statementRanges(doc).map((range) => doc.slice(range.from, range.to).trim());
}

/** The statement the cursor at `offset` sits inside. */
function at(doc: string, offset: number): string | undefined {
  const found = statementRanges(doc).find((range) => offset >= range.from && offset <= range.to);
  return found ? doc.slice(found.from, found.to).trim() : undefined;
}

describe('splitting', () => {
  it('separates plain statements', () => {
    expect(pieces('SELECT 1; SELECT 2;')).toEqual(['SELECT 1;', 'SELECT 2;']);
  });

  it('keeps a statement without a terminator', () => {
    expect(pieces('SELECT 1')).toEqual(['SELECT 1']);
  });

  it('returns nothing for an empty document', () => {
    expect(statementRanges('')).toEqual([]);
  });

  it('covers the whole document with no gaps', () => {
    const doc = 'SELECT 1; SELECT 2; SELECT 3';
    const ranges = statementRanges(doc);
    expect(ranges[0]!.from).toBe(0);
    expect(ranges[ranges.length - 1]!.to).toBe(doc.length);
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]!.from).toBe(ranges[index - 1]!.to);
    }
  });
});

describe('quoting', () => {
  it('ignores a semicolon inside a string', () => {
    expect(pieces("SELECT 'a;b'; SELECT 2")).toEqual(["SELECT 'a;b';", 'SELECT 2']);
  });

  it('ignores a semicolon inside a quoted identifier', () => {
    expect(pieces('SELECT * FROM "od;d"; SELECT 2')).toHaveLength(2);
  });

  it('understands a doubled quote as an escape', () => {
    expect(pieces("SELECT 'it''s; fine'; SELECT 2")).toHaveLength(2);
  });

  it('ignores a semicolon inside a dollar-quoted body', () => {
    const doc =
      'CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql; SELECT f()';
    const parts = pieces(doc);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('RETURN 1;');
    expect(parts[1]).toBe('SELECT f()');
  });

  it('requires the dollar tag to match before closing', () => {
    expect(pieces('SELECT $a$ x; $b$ y; $a$; SELECT 2')).toHaveLength(2);
  });

  it('treats a parameter placeholder as ordinary text', () => {
    expect(pieces('SELECT $1; SELECT 2')).toHaveLength(2);
  });

  it('lets an unterminated string swallow the rest', () => {
    expect(pieces("SELECT 'a; SELECT 2")).toHaveLength(1);
  });
});

describe('comments', () => {
  it('ignores a semicolon in a line comment', () => {
    expect(pieces('SELECT 1 -- one; two\n; SELECT 2')).toHaveLength(2);
  });

  it('ignores a semicolon in a block comment', () => {
    expect(pieces('SELECT 1 /* one; two */; SELECT 2')).toHaveLength(2);
  });

  it('lets an unterminated block comment swallow the rest', () => {
    expect(pieces('SELECT 1 /* a; b')).toHaveLength(1);
  });
});

describe('the statement under the cursor', () => {
  const doc = 'SELECT 1;\nSELECT 2;\nSELECT 3';

  it('picks the first statement from the start', () => {
    expect(at(doc, 0)).toBe('SELECT 1;');
    expect(at(doc, 5)).toBe('SELECT 1;');
  });

  it('picks the statement the cursor is in the middle of', () => {
    expect(at(doc, doc.indexOf('SELECT 2') + 3)).toContain('SELECT 2');
  });

  it('picks the last statement at the end of the document', () => {
    expect(at(doc, doc.length)).toContain('SELECT 3');
  });

  it('never returns undefined for an offset inside the document', () => {
    for (let offset = 0; offset <= doc.length; offset += 1) {
      expect(at(doc, offset)).toBeDefined();
    }
  });
});
