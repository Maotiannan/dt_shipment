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
