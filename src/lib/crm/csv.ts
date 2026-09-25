/**
 * CSV writer for exports. Pure.
 * - RFC 4180 quoting (quotes, commas, newlines), CRLF line endings;
 * - UTF-8 with a BOM so Excel opens accented names correctly;
 * - spreadsheet formula injection guard: a text cell starting with
 *   = + - @ tab or CR is prefixed with an apostrophe so Excel / Sheets /
 *   Numbers treat it as text, never as a formula. Real numbers are left
 *   as numbers.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else if (typeof value === 'boolean') text = value ? 'true' : 'false';
  else {
    text = String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvFilename(kind: string, now = new Date()): string {
  return `zayro-${kind}-${now.toISOString().slice(0, 10)}.csv`;
}
