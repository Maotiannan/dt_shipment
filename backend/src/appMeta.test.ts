import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { DEFAULT_APP_META, loadAppMeta } from './appMeta.js'

test('loadAppMeta reads display metadata from repo package file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-shipment-meta-'))
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify(
      {
        name: 'dt-shipment',
        version: '1.2.3',
        displayName: '发货管家',
      },
      null,
      2
    )
  )

  assert.deepEqual(loadAppMeta(tmpDir), {
    name: 'dt-shipment',
    version: '1.2.3',
    displayName: '发货管家',
  })
})

test('loadAppMeta falls back to defaults when package file is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-shipment-meta-empty-'))

  assert.deepEqual(loadAppMeta(tmpDir), DEFAULT_APP_META)
})
