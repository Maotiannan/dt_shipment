export type ImportPreviewAction = 'create' | 'overwrite'
export type ImportPreviewStatus = 'success' | 'warning' | 'error'

export type ImportPreviewRow<T> = {
  row_index: number
  key: string
  action: ImportPreviewAction
  status: ImportPreviewStatus
  errors: string[]
  warnings: string[]
  data: T
}

export type ImportPreviewResult<T> = {
  can_commit: boolean
  rows: Array<ImportPreviewRow<T>>
}

export function summarizeImportPreview<T>(rows: Array<ImportPreviewRow<T>>) {
  return {
    totalCount: rows.length,
    errorCount: rows.filter((row) => row.status === 'error').length,
    warningCount: rows.filter((row) => row.status === 'warning').length,
    overwriteCount: rows.filter((row) => row.action === 'overwrite').length,
  }
}

export function canCommitImportPreview<T>(rows: Array<ImportPreviewRow<T>>) {
  return rows.every((row) => row.status !== 'error')
}

export function updateImportPreviewRow<T>(
  rows: Array<ImportPreviewRow<T>>,
  key: string,
  updater: (row: ImportPreviewRow<T>) => ImportPreviewRow<T>
) {
  return rows.map((row) => (row.key === key ? updater(row) : row))
}

export function removeImportPreviewRow<T>(rows: Array<ImportPreviewRow<T>>, key: string) {
  return rows.filter((row) => row.key !== key)
}
