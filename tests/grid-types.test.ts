import { describe, expect, it } from 'vitest';

import { estimateWidth, fromColumnMeta, fromResultColumns } from '@/components/grid/types';
import type { GridColumn } from '@/components/grid/types';
import type { ColumnMeta, JsonValue, ResultColumn } from '@/types';

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: 'id',
    dataType: 'integer',
    typeCategory: 'number',
    nullable: false,
    default: null,
    isPrimaryKey: true,
    isUnique: false,
    isIdentity: true,
    isGenerated: false,
    comment: null,
    ordinal: 1,
    enumValues: [],
    maxLength: null,
    ...overrides,
  };
}

function grid(overrides: Partial<GridColumn> = {}): GridColumn {
  return {
    name: 'value',
    dataType: 'text',
    typeCategory: 'text',
    editable: true,
    isPrimaryKey: false,
    nullable: true,
    enumValues: [],
    ...overrides,
  };
}

describe('fromColumnMeta', () => {
  it('carries the catalog details the grid needs', () => {
    const [column] = fromColumnMeta([meta({ name: 'status', enumValues: ['a', 'b'] })], true);
    expect(column).toMatchObject({
      name: 'status',
      dataType: 'integer',
      isPrimaryKey: true,
      enumValues: ['a', 'b'],
    });
  });

  it('is read-only when the relation is', () => {
    expect(fromColumnMeta([meta()], false)[0]!.editable).toBe(false);
  });

  it('never lets a generated column be edited', () => {
    // PostgreSQL refuses a write to one, so offering the editor would only
    // produce an error the user cannot act on.
    expect(fromColumnMeta([meta({ isGenerated: true })], true)[0]!.editable).toBe(false);
  });

  it('keeps every column in order', () => {
    const columns = fromColumnMeta([meta({ name: 'a' }), meta({ name: 'b' })], true);
    expect(columns.map((column) => column.name)).toEqual(['a', 'b']);
  });

  it('handles an empty relation', () => {
    expect(fromColumnMeta([], true)).toEqual([]);
  });
});

describe('fromResultColumns', () => {
  const result: ResultColumn = { name: 'total', dataType: 'bigint', typeCategory: 'number' };

  it('is always read-only, because a result set has no row identity', () => {
    expect(fromResultColumns([result])[0]!.editable).toBe(false);
  });

  it('keeps the name and type', () => {
    expect(fromResultColumns([result])[0]).toMatchObject({
      name: 'total',
      dataType: 'bigint',
      typeCategory: 'number',
    });
  });

  it('assumes nullable, since a computed column can be anything', () => {
    expect(fromResultColumns([result])[0]!.nullable).toBe(true);
    expect(fromResultColumns([result])[0]!.isPrimaryKey).toBe(false);
  });
});

describe('estimateWidth', () => {
  const rows: JsonValue[][] = [['short'], ['a much longer value than the header']];

  it('never goes below the floor', () => {
    expect(estimateWidth(grid({ name: 'a' }), [], 0)).toBeGreaterThanOrEqual(72);
  });

  it('leaves room for a long header', () => {
    const narrow = estimateWidth(grid({ name: 'id' }), [], 0);
    const wide = estimateWidth(grid({ name: 'a_very_long_column_name_indeed' }), [], 0);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('grows with the widest sampled value', () => {
    const withData = estimateWidth(grid({ name: 'a' }), rows, 0);
    const empty = estimateWidth(grid({ name: 'a' }), [], 0);
    expect(withData).toBeGreaterThan(empty);
  });

  it('caps how wide one column may get', () => {
    const huge: JsonValue[][] = [['x'.repeat(5000)]];
    expect(estimateWidth(grid({ name: 'a' }), huge, 0)).toBeLessThanOrEqual(420);
  });

  it('gives known types a sensible minimum', () => {
    expect(estimateWidth(grid({ name: 'a', typeCategory: 'uuid' }), [], 0)).toBe(290);
    expect(estimateWidth(grid({ name: 'a', typeCategory: 'timestamp' }), [], 0)).toBe(190);
    expect(estimateWidth(grid({ name: 'a', typeCategory: 'boolean' }), [], 0)).toBe(84);
  });

  it('samples at most the first rows so a big page stays cheap', () => {
    const wideRowLate: JsonValue[][] = [
      ...Array.from({ length: 60 }, () => ['x'] as JsonValue[]),
      ['y'.repeat(300)],
    ];
    const sampled: JsonValue[][] = [['y'.repeat(300)]];
    expect(estimateWidth(grid({ name: 'a' }), wideRowLate, 0)).toBeLessThan(
      estimateWidth(grid({ name: 'a' }), sampled, 0),
    );
  });

  it('treats a missing or null cell as the width of NULL', () => {
    const withNulls: JsonValue[][] = [[null], []];
    expect(estimateWidth(grid({ name: 'a' }), withNulls, 0)).toBeGreaterThanOrEqual(72);
  });

  it('measures the column at the given index, not the first one', () => {
    const twoColumns: JsonValue[][] = [['x', 'a much longer second column value']];
    expect(estimateWidth(grid({ name: 'a' }), twoColumns, 1)).toBeGreaterThan(
      estimateWidth(grid({ name: 'a' }), twoColumns, 0),
    );
  });

  it('always returns a whole number of pixels', () => {
    expect(Number.isInteger(estimateWidth(grid({ name: 'abc' }), rows, 0))).toBe(true);
  });
});
