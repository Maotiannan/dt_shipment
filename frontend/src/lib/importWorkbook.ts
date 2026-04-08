import * as XLSX from 'xlsx'

export async function parseSpreadsheetFile(file: File) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? '']

  if (!firstSheet) {
    throw new Error('未找到可解析的表格')
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: '',
    raw: false,
  })

  if (rows.length === 0) {
    throw new Error('表格中没有数据行')
  }

  return rows
}

export function mapSpreadsheetRows(
  rows: Array<Record<string, unknown>>,
  headerMap: Record<string, string>
) {
  return rows.map((row) => {
    const mapped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      mapped[headerMap[key] ?? key] = value
    }
    return mapped
  })
}

export function downloadCsvTemplate(
  filename: string,
  headers: string[],
  exampleRows: Array<Array<string | number>>
) {
  const lines = [headers.join(','), ...exampleRows.map((row) => row.join(','))]
  const blob = new Blob(['\ufeff', lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
