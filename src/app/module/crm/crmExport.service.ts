import ExcelJS from 'exceljs'

export type CrmExportColumn = {
  header: string
  key: string
  width?: number
}

export type CrmExportRow = Record<string, unknown>

const formulaPrefix = /^[\t\r ]*[=+\-@]/

export const sanitizeSpreadsheetValue = (value: unknown): string | number | boolean => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const text = Array.isArray(value) ? value.join('; ') : String(value)
  // CSV/XLSX files are frequently opened by spreadsheet software. Prefix values
  // that could be interpreted as formulas so user-controlled CRM data cannot
  // trigger formula execution on open.
  return formulaPrefix.test(text) ? `'${text}` : text
}

const escapeCsv = (value: unknown): string => {
  const safe = String(sanitizeSpreadsheetValue(value))
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const buildCrmCsv = (columns: CrmExportColumn[], rows: CrmExportRow[]): string => [
  columns.map((column) => escapeCsv(column.header)).join(','),
  ...rows.map((row) => columns.map((column) => escapeCsv(row[column.key])).join(',')),
].join('\n')

export const buildCrmXlsx = async (
  sheetName: string,
  columns: CrmExportColumn[],
  rows: CrmExportRow[],
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Opygen Estate'
  workbook.company = 'Opygen Estate'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31))
  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: Math.min(60, Math.max(12, column.width || column.header.length + 4)),
  }))
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of rows) {
    const safeRow: Record<string, string | number | boolean> = {}
    for (const column of columns) safeRow[column.key] = sanitizeSpreadsheetValue(row[column.key])
    worksheet.addRow(safeRow)
  }

  const header = worksheet.getRow(1)
  header.font = { bold: true }
  header.alignment = { vertical: 'middle' }
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, columns.length) },
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
