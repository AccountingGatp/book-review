// ExcelJS-based workbook reader. Kept separate so engine.js has zero imports.
// Node: `import { parseWorkbookRows } from './xlsx_io.js'`
// Browser: load vendor exceljs.min.js first (sets globalThis.ExcelJS) or pass the library as 2nd argument.

let _ExcelJS = null;
async function getExcelJS(lib) {
  if (lib) return lib;
  if (_ExcelJS) return _ExcelJS;
  if (globalThis.ExcelJS) { _ExcelJS = globalThis.ExcelJS; return _ExcelJS; }
  throw new Error('Excel library not loaded');
}

function cellValue(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v;
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return v;
  if (t === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(x => x.text).join('');
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) return cellValue(v.result);
    if ('error' in v) return String(v.error);
    if ('text' in v) return cellValue(v.text);
    if ('hyperlink' in v) return String(v.hyperlink);
  }
  return String(v);
}

/** Read the first sheet of an .xlsx (ArrayBuffer / Uint8Array / Node Buffer) into dense row arrays.
 *  Row i of the result is Excel row i+1 (blank rows kept so source-row numbers match). */
export async function parseWorkbookRows(arrayBuffer, ExcelJSLib) {
  const ExcelJS = await getExcelJS(ExcelJSLib);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const nRows = ws.rowCount;
  const nCols = ws.columnCount;
  const out = new Array(nRows);
  for (let r = 1; r <= nRows; r++) {
    const row = ws.getRow(r);
    const arr = new Array(nCols).fill(null);
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      if (c > nCols) return;
      // ExcelJS' cell.value drops falsy formula results (e.g. 0); read the model result directly
      if (cell.type === 6) arr[c - 1] = cellValue(cell.result === undefined ? null : cell.result);
      else arr[c - 1] = cellValue(cell.value);
    });
    out[r - 1] = arr;
  }
  return out;
}
