import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import ApiError from '../../../errors/ApiError'

const MAX_XLSX_ENTRIES = 2_000
const MAX_XLSX_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024

export type ParsedSpreadsheetUpload = {
  headers: string[]
  rows: Array<{ row: number; values: unknown[] }>
  sheetName?: string
}

export const csvCell = (value: string): string => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

const parseCsv = (buffer: Buffer, entityLabel: string): ParsedSpreadsheetUpload => {
  if (!buffer.length) throw new ApiError(400, `${entityLabel} import file is empty`)
  if (buffer.includes(0)) throw new ApiError(400, 'CSV file must be UTF-8 text, not a binary or UTF-16 file')
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  if (!text.trim()) throw new ApiError(400, `${entityLabel} import file is empty`)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(field); field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field); field = ''
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
    } else {
      field += char
    }
  }

  if (quoted) throw new ApiError(400, 'CSV contains an unterminated quoted field')
  row.push(field)
  if (row.some((value) => value.trim())) rows.push(row)
  if (rows.length < 2) throw new ApiError(400, `${entityLabel} import file must include a header row and at least one data row`)

  return {
    headers: rows[0].map((value) => value.trim()),
    rows: rows.slice(1).map((values, index) => ({ row: index + 2, values })),
  }
}

const findZipEocd = (buffer: Buffer): number => {
  const min = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

const assertSafeXlsxArchive = (buffer: Buffer, entityLabel: string): void => {
  const eocd = findZipEocd(buffer)
  if (eocd < 0) throw new ApiError(400, 'Excel file is not a valid XLSX archive')
  const entries = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ApiError(400, `ZIP64 XLSX files are not supported for ${entityLabel.toLowerCase()} import`)
  }
  if (entries < 1 || entries > MAX_XLSX_ENTRIES || centralOffset + centralSize > buffer.length) {
    throw new ApiError(400, 'Excel file archive structure is invalid or too large')
  }

  const centralEnd = centralOffset + centralSize
  let offset = centralOffset
  let totalUncompressed = 0
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > centralEnd || offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new ApiError(400, 'Excel file archive directory is invalid')
    }
    const flags = buffer.readUInt16LE(offset + 8)
    const compression = buffer.readUInt16LE(offset + 10)
    const uncompressed = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    if (flags & 0x1) throw new ApiError(400, 'Password-protected Excel files cannot be imported')
    if (compression !== 0 && compression !== 8) throw new ApiError(400, 'Excel file uses unsupported ZIP compression')
    if (uncompressed > MAX_XLSX_ENTRY_BYTES) throw new ApiError(413, 'Excel file contains an oversized worksheet entry')
    totalUncompressed += uncompressed
    if (totalUncompressed > MAX_XLSX_UNCOMPRESSED_BYTES) throw new ApiError(413, 'Excel file expands beyond the safe import limit')
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength
    if (nextOffset > centralEnd || nextOffset > buffer.length) throw new ApiError(400, 'Excel file archive directory is truncated')
    offset = nextOffset
  }
  if (offset > centralEnd) throw new ApiError(400, 'Excel file archive directory is invalid')
}

// Some third-party tools (other CRMs, spreadsheet generators, export scripts) produce
// technically-parseable OOXML that still trips up ExcelJS's non-namespace-aware reader:
// every element wrapped in a custom XML namespace prefix (e.g. <x:workbook>, <x:sheet>)
// instead of the unprefixed elements Excel/LibreOffice normally emit, and/or relationship
// Targets written as absolute part paths ("/xl/styles.xml") instead of relative ones
// ("styles.xml"). Both are valid per the OOXML/OPC spec, but ExcelJS matches tag names and
// resolves relationships literally, so it silently ends up with an empty workbook model and
// throws "Cannot read properties of undefined (reading 'sheets')". Normalizing the archive
// before handing it to ExcelJS keeps those files importable without weakening the archive
// safety checks above, which still run first against the original untrusted bytes.
const normalizeXlsxArchive = async (buffer: Buffer): Promise<Buffer> => {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return buffer
  }

  let changed = false
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.toLowerCase().endsWith('.xml')) continue
    let text: string
    try {
      text = await entry.async('string')
    } catch {
      continue
    }
    let updated = text

    // Strip any declared namespace prefix bound to a spreadsheetml/package/relationships
    // namespace so tags like <x:workbook> read as the plain <workbook> ExcelJS expects.
    const prefixMatches = [...text.matchAll(/xmlns:([A-Za-z0-9]+)="[^"]*(?:spreadsheetml|package\/2006\/relationships)[^"]*"/g)]
    for (const match of prefixMatches) {
      const prefix = match[1]
      if (!new RegExp(`</?${prefix}:`).test(updated)) continue
      updated = updated
        .replace(new RegExp(`<${prefix}:`, 'g'), '<')
        .replace(new RegExp(`</${prefix}:`, 'g'), '</')
        .replace(new RegExp(`\\sxmlns:${prefix}="[^"]*"`, 'g'), '')
    }

    // Normalize absolute relationship targets ("/xl/worksheets/sheet1.xml") to the
    // relative form ExcelJS expects when resolving parts within the archive. (Note:
    // [Content_Types].xml's PartName is required by spec to stay absolute, so it's left alone.)
    if (name.endsWith('.rels')) {
      updated = updated.replace(/Target="\/([^"]+)"/g, 'Target="$1"')
    }

    if (updated !== text) {
      zip.file(name, updated)
      changed = true
    }
  }

  if (!changed) return buffer
  try {
    return await zip.generateAsync({ type: 'nodebuffer' })
  } catch {
    return buffer
  }
}

const excelCellValue = (value: ExcelJS.CellValue): unknown => {
  if (value == null) return ''
  if (value instanceof Date) return value
  if (typeof value !== 'object') return value
  if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
  if ('text' in value && typeof value.text === 'string') return value.text
  if ('result' in value) return value.result ?? ''
  return String(value)
}

const parseXlsx = async (buffer: Buffer, entityLabel: string): Promise<ParsedSpreadsheetUpload> => {
  assertSafeXlsxArchive(buffer, entityLabel)
  const normalizedBuffer = await normalizeXlsxArchive(buffer)
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(normalizedBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  } catch {
    throw new ApiError(400, 'Excel file could not be parsed. Upload a valid .xlsx workbook')
  }
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new ApiError(400, 'Excel workbook does not contain a worksheet')

  const nonEmptyRows: Array<{ row: number; values: unknown[] }> = []
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values: unknown[] = []
    for (let column = 1; column <= row.cellCount; column += 1) values.push(excelCellValue(row.getCell(column).value))
    if (values.some((value) => String(value ?? '').trim())) nonEmptyRows.push({ row: rowNumber, values })
  })
  if (nonEmptyRows.length < 2) throw new ApiError(400, `${entityLabel} import file must include a header row and at least one data row`)
  const [header, ...rows] = nonEmptyRows
  return {
    headers: header.values.map((value) => String(value ?? '').trim()),
    rows,
    sheetName: worksheet.name,
  }
}

export const parseSpreadsheetUpload = async (
  file: Express.Multer.File,
  options: { maxRows: number; entityLabel: string },
): Promise<ParsedSpreadsheetUpload> => {
  const lowerName = file.originalname.toLowerCase()
  const extension = lowerName.endsWith('.xlsx') ? '.xlsx' : lowerName.endsWith('.csv') ? '.csv' : ''
  if (!extension) throw new ApiError(400, `${options.entityLabel} import accepts CSV (.csv) or Excel (.xlsx) files only`)
  const parsed = extension === '.xlsx'
    ? await parseXlsx(file.buffer, options.entityLabel)
    : parseCsv(file.buffer, options.entityLabel)
  if (parsed.rows.length > options.maxRows) {
    throw new ApiError(413, `${options.entityLabel} import supports at most ${options.maxRows.toLocaleString()} rows per file`)
  }
  return parsed
}
