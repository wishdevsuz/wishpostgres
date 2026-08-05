import type { ColumnMeta } from '@/types';

export interface FieldState {
  value: string;
  useDefault: boolean;
  isNull: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

const INTEGER_RANGES: Record<string, [bigint, bigint]> = {
  smallint: [-32768n, 32767n],
  integer: [-2147483648n, 2147483647n],
  bigint: [-9223372036854775808n, 9223372036854775807n],
};

/**
 * Client-side validation for the insert form. It catches the mistakes worth
 * catching before a round trip; PostgreSQL remains the authority.
 */
export function validateField(column: ColumnMeta, state: FieldState): string | null {
  if (state.useDefault) return null;

  if (state.isNull) {
    if (!column.nullable) return 'This column is NOT NULL.';
    return null;
  }

  const value = state.value;

  if (value.trim() === '') {
    if (!column.nullable) return 'This column is required.';
    return null;
  }

  switch (column.typeCategory) {
    case 'number': {
      const base = column.dataType.replace(/\(.*\)/, '').trim();
      const range = INTEGER_RANGES[base];
      if (range) {
        if (!INTEGER.test(value.trim())) return 'Enter a whole number.';
        const parsed = BigInt(value.trim());
        if (parsed < range[0] || parsed > range[1]) return `Out of range for ${base}.`;
        return null;
      }
      if (!DECIMAL.test(value.trim())) return 'Enter a number.';
      return null;
    }

    case 'boolean':
      return ['true', 'false', 't', 'f', 'yes', 'no', '1', '0'].includes(value.trim().toLowerCase())
        ? null
        : 'Enter true or false.';

    case 'uuid':
      return UUID.test(value.trim()) ? null : 'Enter a valid UUID.';

    case 'json':
      try {
        JSON.parse(value);
        return null;
      } catch {
        return 'This is not valid JSON.';
      }

    case 'array':
      return value.trim().startsWith('{') && value.trim().endsWith('}')
        ? null
        : 'Use PostgreSQL array syntax, for example {one,two}.';

    case 'text':
      if (column.maxLength !== null && value.length > column.maxLength) {
        return `Longer than the ${column.maxLength} character limit.`;
      }
      return null;

    default:
      return null;
  }
}
