import fs from 'node:fs'
import path from 'node:path'
import { pool } from '../db.js'

async function main() {
  const sqlPath = path.resolve(process.cwd(), 'db/init.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')
  await pool.query('create extension if not exists pgcrypto;')
  await pool.query(sql)
  console.log('DB initialized.')
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})

