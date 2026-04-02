import fs from 'node:fs'
import path from 'node:path'
import { pool } from '../db.js'
import { runInitDb } from './initDbRunner.js'

async function main() {
  const sqlPath = path.resolve(process.cwd(), 'db/init.sql')
  const schemaSql = fs.readFileSync(sqlPath, 'utf8')

  await runInitDb(pool, schemaSql)
  console.log('DB initialized.')
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})

