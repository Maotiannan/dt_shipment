import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canCommitImportPreview,
  removeImportPreviewRow,
  summarizeImportPreview,
  updateImportPreviewRow,
  type ImportPreviewRow,
} from './importPreview'

type DemoRow = {
  sku_code: string
  name: string
}

function row(overrides: Partial<ImportPreviewRow<DemoRow>> = {}): ImportPreviewRow<DemoRow> {
  return {
    row_index: 1,
    key: 'SKU-1',
    action: 'create',
    status: 'success',
    errors: [],
    warnings: [],
    data: {
      sku_code: 'SKU-1',
      name: 'Alpha',
    },
    ...overrides,
  }
}

test('summarizeImportPreview counts errors, warnings, and overwrite rows', () => {
  const summary = summarizeImportPreview([
    row({ status: 'error', action: 'overwrite' }),
    row({ key: 'SKU-2', status: 'warning' }),
    row({ key: 'SKU-3', status: 'success' }),
  ])

  assert.equal(summary.totalCount, 3)
  assert.equal(summary.errorCount, 1)
  assert.equal(summary.warningCount, 1)
  assert.equal(summary.overwriteCount, 1)
})

test('canCommitImportPreview returns false when any row has error', () => {
  assert.equal(canCommitImportPreview([row(), row({ key: 'SKU-2', status: 'error' })]), false)
  assert.equal(canCommitImportPreview([row(), row({ key: 'SKU-2', status: 'warning' })]), true)
})

test('updateImportPreviewRow patches the matching row only', () => {
  const rows = updateImportPreviewRow(
    [row(), row({ key: 'SKU-2', data: { sku_code: 'SKU-2', name: 'Beta' } })],
    'SKU-2',
    (current) => ({
      ...current,
      data: {
        ...current.data,
        name: 'Beta Updated',
      },
    })
  )

  assert.equal(rows[0]?.data.name, 'Alpha')
  assert.equal(rows[1]?.data.name, 'Beta Updated')
})

test('removeImportPreviewRow removes the matching row', () => {
  const rows = removeImportPreviewRow([row(), row({ key: 'SKU-2' })], 'SKU-2')
  assert.deepEqual(rows.map((item) => item.key), ['SKU-1'])
})
