import { createSpreadsheetImportUpload, SPREADSHEET_IMPORT_MAX_FILE_BYTES } from '../import/spreadsheetImport.middleware'

export const LEAD_IMPORT_MAX_FILE_BYTES = SPREADSHEET_IMPORT_MAX_FILE_BYTES
export const leadImportUpload = createSpreadsheetImportUpload('Lead')
