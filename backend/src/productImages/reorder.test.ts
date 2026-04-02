import test from 'node:test'
import assert from 'node:assert/strict'
import {
  moveImageByDelta,
  nextPrimaryAfterDelete,
  resequenceSortOrder,
} from './reorder.js'

test('moveImageByDelta swaps sort positions safely', () => {
  const result = moveImageByDelta(
    [
      { image_id: 'a', sort_order: 1, is_primary: true },
      { image_id: 'b', sort_order: 2, is_primary: false },
      { image_id: 'c', sort_order: 3, is_primary: false },
    ],
    'b',
    -1
  )

  assert.deepEqual(
    result.map((item) => [item.image_id, item.sort_order]),
    [
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]
  )
})

test('resequenceSortOrder normalizes sort order without mutating input', () => {
  const items = [
    { image_id: 'c', sort_order: 3, is_primary: false },
    { image_id: 'a', sort_order: 1, is_primary: true },
    { image_id: 'b', sort_order: 2, is_primary: false },
  ]
  const snapshot = structuredClone(items)

  const result = resequenceSortOrder(items)

  assert.deepEqual(result.map((item) => [item.image_id, item.sort_order]), [
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ])
  assert.deepEqual(items, snapshot)
})

test('moveImageByDelta normalizes non-normalized input on boundary no-op', () => {
  const items = [
    { image_id: 'a', sort_order: 30, is_primary: true },
    { image_id: 'b', sort_order: 10, is_primary: false },
    { image_id: 'c', sort_order: 20, is_primary: false },
  ]
  const snapshot = structuredClone(items)

  const moveFirstUp = moveImageByDelta(items, 'b', -1)

  assert.deepEqual(moveFirstUp.map((item) => [item.image_id, item.sort_order]), [
    ['b', 1],
    ['c', 2],
    ['a', 3],
  ])
  assert.deepEqual(items, snapshot)
})

test('moveImageByDelta normalizes non-normalized input on missing image no-op', () => {
  const items = [
    { image_id: 'a', sort_order: 30, is_primary: true },
    { image_id: 'b', sort_order: 10, is_primary: false },
    { image_id: 'c', sort_order: 20, is_primary: false },
  ]
  const snapshot = structuredClone(items)

  const result = moveImageByDelta(items, 'missing', 1)

  assert.deepEqual(result.map((item) => [item.image_id, item.sort_order]), [
    ['b', 1],
    ['c', 2],
    ['a', 3],
  ])
  assert.deepEqual(items, snapshot)
})

test('nextPrimaryAfterDelete promotes the earliest surviving image', () => {
  const next = nextPrimaryAfterDelete([
    { image_id: 'b', sort_order: 2, is_primary: false },
    { image_id: 'c', sort_order: 3, is_primary: false },
  ])

  assert.equal(next?.image_id, 'b')
})
