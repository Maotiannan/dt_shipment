import assert from 'node:assert/strict'
import test from 'node:test'

import {
  moveProductImage,
  normalizeProductImageState,
  removeProductImage,
  setPrimaryProductImage,
} from './productImageState.js'

test('normalizeProductImageState sorts by sort_order and keeps a single primary image', () => {
  const result = normalizeProductImageState([
    {
      image_id: 'img-b',
      sort_order: 2,
      is_primary: true,
      status: 'active',
      deleted_at: null,
    },
    {
      image_id: 'img-a',
      sort_order: 1,
      is_primary: true,
      status: 'active',
      deleted_at: null,
    },
  ])

  assert.deepEqual(
    result.map((item) => [item.image_id, item.sort_order, item.is_primary]),
    [
      ['img-a', 1, true],
      ['img-b', 2, false],
    ]
  )
})

test('moveProductImage swaps with the adjacent image and resequences sort order', () => {
  const result = moveProductImage(
    [
      {
        image_id: 'img-a',
        sort_order: 1,
        is_primary: true,
        status: 'active',
        deleted_at: null,
      },
      {
        image_id: 'img-b',
        sort_order: 2,
        is_primary: false,
        status: 'active',
        deleted_at: null,
      },
      {
        image_id: 'img-c',
        sort_order: 3,
        is_primary: false,
        status: 'active',
        deleted_at: null,
      },
    ],
    'img-b',
    -1
  )

  assert.deepEqual(
    result.map((item) => [item.image_id, item.sort_order, item.is_primary]),
    [
      ['img-b', 1, false],
      ['img-a', 2, true],
      ['img-c', 3, false],
    ]
  )
})

test('removeProductImage promotes the next image when the primary image is removed', () => {
  const result = removeProductImage(
    [
      {
        image_id: 'img-a',
        sort_order: 1,
        is_primary: true,
        status: 'active',
        deleted_at: null,
      },
      {
        image_id: 'img-b',
        sort_order: 2,
        is_primary: false,
        status: 'active',
        deleted_at: null,
      },
      {
        image_id: 'img-c',
        sort_order: 3,
        is_primary: false,
        status: 'active',
        deleted_at: null,
      },
    ],
    'img-a'
  )

  assert.deepEqual(
    result.map((item) => [item.image_id, item.sort_order, item.is_primary]),
    [
      ['img-b', 1, true],
      ['img-c', 2, false],
    ]
  )
})

test('setPrimaryProductImage keeps the selected image first in the primary order', () => {
  const result = setPrimaryProductImage(
    [
      {
        image_id: 'img-a',
        sort_order: 1,
        is_primary: true,
        status: 'active',
        deleted_at: null,
      },
      {
        image_id: 'img-b',
        sort_order: 2,
        is_primary: false,
        status: 'active',
        deleted_at: null,
      },
    ],
    'img-b'
  )

  assert.deepEqual(
    result.map((item) => [item.image_id, item.sort_order, item.is_primary]),
    [
      ['img-a', 1, false],
      ['img-b', 2, true],
    ]
  )
})
