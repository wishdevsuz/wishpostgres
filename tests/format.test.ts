import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  displayValue,
  formatBytes,
  formatCount,
  formatDuration,
  formatRelativeTime,
  formatTimestamp,
  isNumericCategory,
  pluralise,
  rawValue,
  summariseSql,
  truncate,
} from '@/utils/format';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('leaves small numbers alone', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
  });

  it('handles negatives', () => {
    expect(formatCount(-1500)).toBe('-1,500');
  });

  it('shows a dash when there is no number', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('keeps bytes exact below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('steps up through the units', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
    expect(formatBytes(1024 ** 5)).toBe('1.0 PB');
  });

  it('stops at the largest unit rather than inventing one', () => {
    expect(formatBytes(1024 ** 6)).toMatch(/PB$/);
  });

  it('rounds to one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('shows a dash when the size is unknown', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('collapses anything under a millisecond', () => {
    expect(formatDuration(0)).toBe('<1 ms');
    expect(formatDuration(0.4)).toBe('<1 ms');
  });

  it('reports milliseconds as whole numbers', () => {
    expect(formatDuration(1)).toBe('1 ms');
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(12.6)).toBe('13 ms');
  });

  it('switches to seconds at a second', () => {
    expect(formatDuration(1000)).toBe('1.00 s');
    expect(formatDuration(59_999)).toBe('60.00 s');
  });

  it('switches to minutes at a minute', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(3_600_000)).toBe('60m 0s');
  });
});

describe('formatRelativeTime', () => {
  it('says never when there is no timestamp', () => {
    expect(formatRelativeTime(null)).toBe('never');
    expect(formatRelativeTime(undefined)).toBe('never');
    expect(formatRelativeTime('')).toBe('never');
  });

  it('says never rather than "Invalid Date" for junk', () => {
    expect(formatRelativeTime('not a date')).toBe('never');
  });

  it('describes recent moments in words', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));

    expect(formatRelativeTime('2026-08-09T11:59:50Z')).toBe('just now');
    expect(formatRelativeTime('2026-08-09T11:59:00Z')).toBe('a minute ago');
    expect(formatRelativeTime('2026-08-09T11:30:00Z')).toBe('30 minutes ago');
    expect(formatRelativeTime('2026-08-09T09:00:00Z')).toBe('3 hours ago');
    expect(formatRelativeTime('2026-08-09T11:00:00Z')).toBe('1 hour ago');
    expect(formatRelativeTime('2026-08-07T12:00:00Z')).toBe('2 days ago');
    expect(formatRelativeTime('2026-08-08T12:00:00Z')).toBe('1 day ago');
  });

  it('falls back to a date once it is more than a month old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));
    expect(formatRelativeTime('2026-01-01T12:00:00Z')).not.toContain('ago');
  });
});

describe('formatTimestamp', () => {
  it('renders a readable local time', () => {
    const rendered = formatTimestamp('2026-08-09T12:34:56Z');
    expect(rendered).toContain('2026');
    expect(rendered).not.toBe('2026-08-09T12:34:56Z');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatTimestamp('nonsense')).toBe('nonsense');
  });
});

describe('displayValue', () => {
  it('names NULL explicitly', () => {
    expect(displayValue(null)).toBe('NULL');
  });

  it('passes strings through, including an empty one', () => {
    expect(displayValue('hello')).toBe('hello');
    expect(displayValue('')).toBe('');
    // A string that reads "NULL" is not the same as a NULL.
    expect(displayValue('NULL')).toBe('NULL');
  });

  it('renders booleans and numbers plainly', () => {
    expect(displayValue(true)).toBe('true');
    expect(displayValue(false)).toBe('false');
    expect(displayValue(0)).toBe('0');
    expect(displayValue(-1.5)).toBe('-1.5');
  });

  it('renders structured values as JSON', () => {
    expect(displayValue({ a: 1 })).toBe('{"a":1}');
    expect(displayValue([1, 2])).toBe('[1,2]');
  });
});

describe('rawValue', () => {
  it('turns NULL into an empty string so the editor starts blank', () => {
    expect(rawValue(null)).toBe('');
  });

  it('matches displayValue for everything else', () => {
    expect(rawValue('hello')).toBe('hello');
    expect(rawValue(42)).toBe('42');
    expect(rawValue(false)).toBe('false');
    expect(rawValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('isNumericCategory', () => {
  it('is true only for numbers, which are the right-aligned columns', () => {
    expect(isNumericCategory('number')).toBe(true);
    expect(isNumericCategory('text')).toBe(false);
    expect(isNumericCategory('date')).toBe(false);
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly10!', 10)).toBe('exactly10!');
  });

  it('adds an ellipsis when it has to cut', () => {
    expect(truncate('abcdefghijk', 10)).toBe('abcdefghi…');
    expect(truncate('abcdefghijk', 10)).toHaveLength(10);
  });
});

describe('summariseSql', () => {
  it('collapses whitespace onto one line', () => {
    expect(summariseSql('SELECT\n  1,\n  2')).toBe('SELECT 1, 2');
  });

  it('trims and truncates long statements', () => {
    const long = `SELECT ${'a'.repeat(200)}`;
    expect(summariseSql(long, 20)).toHaveLength(20);
  });

  it('handles an empty statement', () => {
    expect(summariseSql('   ')).toBe('');
  });
});

describe('pluralise', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralise(1, 'row')).toBe('1 row');
  });

  it('uses the plural for anything else', () => {
    expect(pluralise(0, 'row')).toBe('0 rows');
    expect(pluralise(2, 'row')).toBe('2 rows');
  });

  it('accepts an irregular plural', () => {
    expect(pluralise(2, 'index', 'indexes')).toBe('2 indexes');
  });

  it('groups thousands in the count', () => {
    expect(pluralise(1500, 'row')).toBe('1,500 rows');
  });
});
