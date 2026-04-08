import { downloadCsvTemplate } from './importWorkbook'

export type ImportTemplateDefinition = {
  filename: string
  headers: string[]
  exampleRows: Array<Array<string | number>>
}

export const ORDER_IMPORT_TEMPLATE: ImportTemplateDefinition = {
  filename: '发货管家_订单导入模板.csv',
  headers: [
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
  ],
  exampleRows: [
    ['10001', 'wholesale', '女装专号', '张三', '广东省广州市天河区xx路xx号', 'SKU-001', '连衣裙', 2, 59.9, 'false', '', ''],
  ],
}

export const SKU_IMPORT_TEMPLATE: ImportTemplateDefinition = {
  filename: '发货管家_SKU导入模板.csv',
  headers: ['SKU编码', '产品名称', '类目', '颜色', '规格', '单价', '库存', '状态'],
  exampleRows: [['SKU-001', '示例短袖', '上衣', '白色', 'M', 49.9, 12, 'active']],
}

export function downloadImportTemplate(template: ImportTemplateDefinition) {
  downloadCsvTemplate(template.filename, template.headers, template.exampleRows)
}
