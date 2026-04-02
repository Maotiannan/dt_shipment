import test from 'node:test'
import assert from 'node:assert/strict'
import {
  moveImageByDelta,
  nextPrimaryAfterDelete,
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

test('nextPrimaryAfterDelete promotes the earliest surviving image', () => {
  const next = nextPrimaryAfterDelete([
    { image_id: 'b', sort_order: 2, is_primary: false },
    { image_id: 'c', sort_order: 3, is_primary: false },
  ])

  assert.equal(next?.image_id, 'b')
})
