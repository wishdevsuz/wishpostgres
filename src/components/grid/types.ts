import type { ColumnMeta, JsonValue, ResultColumn, TypeCategory } from '@/types';

/** The column shape the grid renders, shared by browse results and SQL results. */
export interface GridColumn {
  name: string;
  dataType: string;
  typeCategory: TypeCategory;
  editable: boolean;
  isPrimaryKey: boolean;
  nullable: boolean;
  enumValues: string[];
}

export interface CellAddress {
  row: number;
  column: number;
}

export interface GridSelection {
  active: CellAddress | null;
  rows: Set<number>;
}

export function fromColumnMeta(columns: ColumnMeta[], editable: boolean): GridColumn[] {
  return columns.map((column) => ({
    name: column.name,
    dataType: column.dataType,
    typeCategory: column.typeCategory,
    editable: editable && !column.isGenerated,
    isPrimaryKey: column.isPrimaryKey,
    nullable: column.nullable,
    enumValues: column.enumValues,
  }));
}

export function fromResultColumns(columns: ResultColumn[]): GridColumn[] {
  return columns.map((column) => ({
    name: column.name,
    dataType: column.dataType,
    typeCategory: column.typeCategory,
    editable: false,
    isPrimaryKey: false,
    nullable: true,
    enumValues: [],
  }));
}

/** Estimate a sensible starting width from the type and the sampled values. */
export function estimateWidth(column: GridColumn, sample: JsonValue[][], index: number): number {
  const header = column.name.length * 7 + 52;
  let widest = 0;
  const limit = Math.min(sample.length, 40);
  for (let row = 0; row < limit; row += 1) {
    const value = sample[row]?.[index];
    const length = value === null || value === undefined ? 4 : String(value).length;
    if (length > widest) widest = length;
  }

  const byType: Partial<Record<TypeCategory, number>> = {
    boolean: 84,
    number: 110,
    uuid: 290,
    date: 110,
    time: 110,
    timestamp: 190,
    json: 280,
  };

  const content = Math.min(widest * 7.4 + 26, 420);
  return Math.round(Math.max(header, byType[column.typeCategory] ?? 0, content, 72));
}
