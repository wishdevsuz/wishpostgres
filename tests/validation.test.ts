import { describe, expect, it } from 'vitest';

import { validateField, type FieldState } from '@/utils/validation';
import type { ColumnMeta, TypeCategory } from '@/types';

function column(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: 'value',
    dataType: 'text',
    typeCategory: 'text',
    nullable: true,
    default: null,
    isPrimaryKey: false,
    isUnique: false,
    isIdentity: false,
    isGenerated: false,
    comment: null,
    ordinal: 1,
    enumValues: [],
    maxLength: null,
    ...overrides,
  };
}

function state(overrides: Partial<FieldState> = {}): FieldState {
  return { value: '', useDefault: false, isNull: false, ...overrides };
}

function check(
  value: string,
  category: TypeCategory,
  overrides: Partial<ColumnMeta> = {},
): string | null {
  return validateField(column({ typeCategory: category, ...overrides }), state({ value }));
}

describe('defaults and nulls', () => {
  it('skips validation entirely when the default is used', () => {
    const notNullNumber = column({ typeCategory: 'number', nullable: false });
    expect(validateField(notNullNumber, state({ useDefault: true, value: 'junk' }))).toBeNull();
  });

  it('accepts NULL for a nullable column', () => {
    expect(validateField(column(), state({ isNull: true }))).toBeNull();
  });

  it('rejects NULL for a NOT NULL column', () => {
    const message = validateField(column({ nullable: false }), state({ isNull: true }));
    expect(message).toBe('This column is NOT NULL.');
  });

  it('treats a blank value as missing on a NOT NULL column', () => {
    expect(validateField(column({ nullable: false }), state({ value: '  ' }))).toBe(
      'This column is required.',
    );
  });

  it('accepts a blank value on a nullable column', () => {
    expect(validateField(column(), state({ value: '' }))).toBeNull();
  });
});

describe('numbers', () => {
  it('accepts whole numbers for integer types', () => {
    expect(check('42', 'number', { dataType: 'integer' })).toBeNull();
    expect(check('-42', 'number', { dataType: 'integer' })).toBeNull();
    expect(check('0', 'number', { dataType: 'integer' })).toBeNull();
  });

  it('rejects a decimal for an integer column', () => {
    expect(check('1.5', 'number', { dataType: 'integer' })).toBe('Enter a whole number.');
  });

  it('enforces the range of each integer width', () => {
    expect(check('32767', 'number', { dataType: 'smallint' })).toBeNull();
    expect(check('32768', 'number', { dataType: 'smallint' })).toBe('Out of range for smallint.');
    expect(check('-32768', 'number', { dataType: 'smallint' })).toBeNull();
    expect(check('-32769', 'number', { dataType: 'smallint' })).toBe('Out of range for smallint.');

    expect(check('2147483647', 'number', { dataType: 'integer' })).toBeNull();
    expect(check('2147483648', 'number', { dataType: 'integer' })).toBe(
      'Out of range for integer.',
    );

    expect(check('9223372036854775807', 'number', { dataType: 'bigint' })).toBeNull();
    expect(check('9223372036854775808', 'number', { dataType: 'bigint' })).toBe(
      'Out of range for bigint.',
    );
  });

  it('ignores a type modifier when picking the range', () => {
    expect(check('1', 'number', { dataType: 'integer(0)' })).toBeNull();
  });

  it('accepts decimals and scientific notation for non-integer numbers', () => {
    expect(check('1.5', 'number', { dataType: 'numeric' })).toBeNull();
    expect(check('.5', 'number', { dataType: 'numeric' })).toBeNull();
    expect(check('5.', 'number', { dataType: 'numeric' })).toBeNull();
    expect(check('-1.5e10', 'number', { dataType: 'double precision' })).toBeNull();
    expect(check('1E-5', 'number', { dataType: 'double precision' })).toBeNull();
  });

  it('rejects text in a numeric column', () => {
    expect(check('abc', 'number', { dataType: 'numeric' })).toBe('Enter a number.');
    expect(check('1,5', 'number', { dataType: 'numeric' })).toBe('Enter a number.');
  });

  it('tolerates surrounding whitespace', () => {
    expect(check('  42  ', 'number', { dataType: 'integer' })).toBeNull();
  });
});

describe('booleans', () => {
  it('accepts every spelling PostgreSQL does', () => {
    for (const value of ['true', 'false', 't', 'f', 'yes', 'no', '1', '0']) {
      expect(check(value, 'boolean')).toBeNull();
    }
  });

  it('is case insensitive', () => {
    expect(check('TRUE', 'boolean')).toBeNull();
    expect(check('No', 'boolean')).toBeNull();
  });

  it('rejects anything else', () => {
    expect(check('maybe', 'boolean')).toBe('Enter true or false.');
    expect(check('2', 'boolean')).toBe('Enter true or false.');
  });
});

describe('uuids', () => {
  it('accepts a canonical uuid in either case', () => {
    expect(check('11111111-2222-3333-4444-555555555555', 'uuid')).toBeNull();
    expect(check('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', 'uuid')).toBeNull();
  });

  it('rejects the wrong shape', () => {
    expect(check('11111111222233334444555555555555', 'uuid')).toBe('Enter a valid UUID.');
    expect(check('11111111-2222-3333-4444-55555555555', 'uuid')).toBe('Enter a valid UUID.');
    expect(check('gggggggg-2222-3333-4444-555555555555', 'uuid')).toBe('Enter a valid UUID.');
  });
});

describe('json', () => {
  it('accepts every JSON shape', () => {
    expect(check('{"a":1}', 'json')).toBeNull();
    expect(check('[1,2]', 'json')).toBeNull();
    expect(check('"text"', 'json')).toBeNull();
    expect(check('42', 'json')).toBeNull();
    expect(check('null', 'json')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(check('{a:1}', 'json')).toBe('This is not valid JSON.');
    expect(check('{', 'json')).toBe('This is not valid JSON.');
  });
});

describe('arrays', () => {
  it('accepts PostgreSQL array literals', () => {
    expect(check('{}', 'array')).toBeNull();
    expect(check('{one,two}', 'array')).toBeNull();
    expect(check('{{1,2},{3,4}}', 'array')).toBeNull();
  });

  it('rejects a JSON array', () => {
    expect(check('[1,2]', 'array')).toContain('PostgreSQL array syntax');
  });
});

describe('text length', () => {
  it('accepts anything when there is no limit', () => {
    expect(check('a'.repeat(10_000), 'text')).toBeNull();
  });

  it('accepts a value at the limit', () => {
    expect(check('abcde', 'text', { maxLength: 5 })).toBeNull();
  });

  it('rejects a value past the limit', () => {
    expect(check('abcdef', 'text', { maxLength: 5 })).toBe('Longer than the 5 character limit.');
  });
});

describe('types with no client-side rule', () => {
  it('leaves the rest to PostgreSQL', () => {
    for (const category of [
      'date',
      'time',
      'timestamp',
      'enum',
      'binary',
      'network',
      'geometric',
      'interval',
      'other',
    ] as TypeCategory[]) {
      expect(check('anything at all', category)).toBeNull();
    }
  });
});
