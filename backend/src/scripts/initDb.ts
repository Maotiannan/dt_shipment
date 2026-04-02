import fs from 'node:fs'
import path from 'node:path'
import { pool } from '../db.js'

async function main() {
  const sqlPath = path.resolve(process.cwd(), 'db/init.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')
  await pool.query('create extension if not exists pgcrypto;')
  await pool.query(sql)

  const { rowCount } = await pool.query(
    `
      select 1
      from pg_indexes
      where schemaname = current_schema()
        and tablename = 'product_images'
        and indexname in ('product_images_sku_sort_idx', 'product_images_primary_idx')
      limit 1
    `
  )

  if (rowCount > 0) {
    await pool.query('drop index if exists product_images_sku_sort_idx;')
    await pool.query('drop index if exists product_images_primary_idx;')
  }

  console.log('DB initialized.')
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})
