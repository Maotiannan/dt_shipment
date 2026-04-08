import assert from 'node:assert/strict'
import test from 'node:test'

import { ORDER_IMPORT_TEMPLATE, SKU_IMPORT_TEMPLATE } from './importTemplates'

test('order import template exposes stable headers and demo row', () => {
  assert.equal(ORDER_IMPORT_TEMPLATE.filename, '发货管家_订单导入模板.csv')
  assert.deepEqual(ORDER_IMPORT_TEMPLATE.headers, [
    '订单号',
    '订单类型',
    '账号名称',
    '买家昵称',
    '收货地址',
    'SKU编码',
    'SKU名称',
    '数量',
    '单价',
    '是否异常',
    '异常类型',
    '异常备注',
  ])
  assert.equal(ORDER_IMPORT_TEMPLATE.exampleRows.length, 1)
  assert.equal(ORDER_IMPORT_TEMPLATE.exampleRows[0]?.length, ORDER_IMPORT_TEMPLATE.headers.length)
})

test('sku import template exposes structured sku headers and demo row', () => {
  assert.equal(SKU_IMPORT_TEMPLATE.filename, '发货管家_SKU导入模板.csv')
  assert.deepEqual(SKU_IMPORT_TEMPLATE.headers, [
    'SKU编码',
    '产品名称',
    '类目',
    '颜色',
    '规格',
    '单价',
    '库存',
    '状态',
  ])
  assert.equal(SKU_IMPORT_TEMPLATE.exampleRows.length, 1)
  assert.equal(SKU_IMPORT_TEMPLATE.exampleRows[0]?.length, SKU_IMPORT_TEMPLATE.headers.length)
})
