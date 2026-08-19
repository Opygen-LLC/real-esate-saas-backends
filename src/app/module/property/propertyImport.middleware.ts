import { createSpreadsheetImportUpload, SPREADSHEET_IMPORT_MAX_FILE_BYTES } from '../import/spreadsheetImport.middleware'

export const PROPERTY_IMPORT_MAX_FILE_BYTES = SPREADSHEET_IMPORT_MAX_FILE_BYTES
export const propertyImportUpload = createSpreadsheetImportUpload('Property')
