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

test('moveImageByDelta no-ops at the boundaries', () => {
  const items = [
    { image_id: 'a', sort_order: 1, is_primary: true },
    { image_id: 'b', sort_order: 2, is_primary: false },
    { image_id: 'c', sort_order: 3, is_primary: false },
  ]
  const snapshot = structuredClone(items)

  const moveFirstUp = moveImageByDelta(items, 'a', -1)
  const moveLastDown = moveImageByDelta(items, 'c', 1)

  assert.deepEqual(moveFirstUp, snapshot)
  assert.deepEqual(moveLastDown, snapshot)
  assert.deepEqual(items, snapshot)
})

test('moveImageByDelta no-ops when the image id is missing', () => {
  const items = [
    { image_id: 'a', sort_order: 1, is_primary: true },
    { image_id: 'b', sort_order: 2, is_primary: false },
    { image_id: 'c', sort_order: 3, is_primary: false },
  ]
  const snapshot = structuredClone(items)

  const result = moveImageByDelta(items, 'missing', 1)

  assert.deepEqual(result, snapshot)
  assert.deepEqual(items, snapshot)
})

test('nextPrimaryAfterDelete promotes the earliest surviving image', () => {
  const next = nextPrimaryAfterDelete([
    { image_id: 'b', sort_order: 2, is_primary: false },
    { image_id: 'c', sort_order: 3, is_primary: false },
  ])

  assert.equal(next?.image_id, 'b')
})
