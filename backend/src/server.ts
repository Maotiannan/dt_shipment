import cors from 'cors'
import express from 'express'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { pool } from './db.js'
import { requireAuth, signToken, type AuthPayload } from './auth.js'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 8787)

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '123456'

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('select 1')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body as {
    username?: string
    password?: string
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'username/password required' })
  }

  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ error: '账号或密码错误' })
  }

  const plain = ADMIN_PASSWORD
  const hash = process.env.ADMIN_PASSWORD_HASH

  const ok = hash ? await bcrypt.compare(password, hash) : password === plain
  if (!ok) return res.status(401).json({ error: '账号或密码错误' })

  const payload: AuthPayload = { userId: 1, username }
  const token = signToken(payload)
  return res.json({ token, user: payload })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = (req as typeof req & { user: AuthPayload }).user
  res.json({ user })
})

app.post('/api/auth/logout', requireAuth, (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/accounts', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    'select account_id,account_name,remark,biz_type,status,created_at from fish_accounts order by created_at desc'
  )
  res.json(rows)
})

app.post('/api/accounts', requireAuth, async (req, res) => {
  const { account_name, remark, biz_type, status } = req.body
  const { rows } = await pool.query(
    `insert into fish_accounts(account_name,remark,biz_type,status)
     values ($1,$2,$3,$4)
     returning account_id,account_name,remark,biz_type,status,created_at`,
    [account_name, remark ?? null, biz_type ?? 'mixed', status ?? 'active']
  )
  res.json(rows[0])
})

app.put('/api/accounts/:id', requireAuth, async (req, res) => {
  const { id } = req.params
  const { account_name, remark, biz_type, status } = req.body
  const { rows } = await pool.query(
    `update fish_accounts
     set account_name=$1, remark=$2, biz_type=$3, status=$4
     where account_id=$5
     returning account_id,account_name,remark,biz_type,status,created_at`,
    [account_name, remark ?? null, biz_type, status, id]
  )
  res.json(rows[0] ?? null)
})

app.get('/api/skus', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `select sku_id,sku_code,name,spec,unit_price,category,status,created_at,inventory_id,inventory_quantity
     from skus order by created_at desc`
  )
  res.json(rows)
})

app.post('/api/skus', requireAuth, async (req, res) => {
  const { sku_code, name, spec, unit_price, category, status, inventory_id } =
    req.body
  const { rows } = await pool.query(
    `insert into skus(sku_code,name,spec,unit_price,category,status,inventory_id)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning sku_id,sku_code,name,spec,unit_price,category,status,created_at,inventory_id,inventory_quantity`,
    [
      sku_code ?? null,
      name,
      spec ?? null,
      unit_price ?? 0,
      category ?? null,
      status ?? 'active',
      inventory_id ?? null,
    ]
  )
  res.json(rows[0])
})

app.put('/api/skus/:id', requireAuth, async (req, res) => {
  const { id } = req.params
  const { sku_code, name, spec, unit_price, category, status, inventory_id } =
    req.body
  const { rows } = await pool.query(
    `update skus
     set sku_code=$1,name=$2,spec=$3,unit_price=$4,category=$5,status=$6,inventory_id=$7
     where sku_id=$8
     returning sku_id,sku_code,name,spec,unit_price,category,status,created_at,inventory_id,inventory_quantity`,
    [sku_code ?? null, name, spec ?? null, unit_price ?? 0, category ?? null, status, inventory_id ?? null, id]
  )
  res.json(rows[0] ?? null)
})

app.get('/api/orders', requireAuth, async (req, res) => {
  const orderType = req.query.order_type as string | undefined
  if (orderType) {
    const { rows } = await pool.query(
      `select * from orders where order_type=$1 order by created_at desc`,
      [orderType]
    )
    return res.json(rows)
  }
  const { rows } = await pool.query(`select * from orders order by created_at desc`)
  return res.json(rows)
})

app.post('/api/orders', requireAuth, async (req, res) => {
  const b = req.body
  const { rows } = await pool.query(
    `insert into orders(
      order_id,account_id,order_type,buyer_name,shipping_address,items,total_amount,
      ship_status,tracking_number,tracking_method,is_abnormal,abnormal_type,remark,
      settlement_status,paid_amount,shipped_at
    ) values (
      $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
    )
    returning *`,
    [
      b.order_id,
      b.account_id,
      b.order_type,
      b.buyer_name,
      b.shipping_address,
      JSON.stringify(b.items ?? []),
      b.total_amount ?? 0,
      b.ship_status ?? 'pending',
      b.tracking_number ?? null,
      b.tracking_method ?? null,
      b.is_abnormal ?? false,
      b.abnormal_type ?? null,
      b.remark ?? null,
      b.settlement_status ?? null,
      b.paid_amount ?? 0,
      b.shipped_at ?? null,
    ]
  )
  res.json(rows[0])
})

app.patch('/api/orders/:id', requireAuth, async (req, res) => {
  const { id } = req.params
  const b = req.body
  const { rows } = await pool.query(
    `update orders
     set ship_status=$1,tracking_number=$2,tracking_method=$3,is_abnormal=$4,abnormal_type=$5,remark=$6,shipped_at=$7
     where order_id=$8
     returning *`,
    [
      b.ship_status,
      b.tracking_number ?? null,
      b.tracking_method ?? null,
      b.is_abnormal ?? false,
      b.abnormal_type ?? null,
      b.remark ?? null,
      b.shipped_at ?? null,
      id,
    ]
  )
  res.json(rows[0] ?? null)
})

app.patch('/api/orders/:id/paid', requireAuth, async (req, res) => {
  const { id } = req.params
  const b = req.body
  const { rows } = await pool.query(
    `update orders
     set paid_amount=$1,settlement_status=$2,paid_at=$3,paid_remark=$4
     where order_id=$5
     returning *`,
    [
      b.paid_amount ?? 0,
      b.settlement_status ?? null,
      b.paid_at ?? null,
      b.paid_remark ?? null,
      id,
    ]
  )
  res.json(rows[0] ?? null)
})

app.post('/api/orders/bulkUpsert', requireAuth, async (req, res) => {
  const rows = (req.body?.rows ?? []) as Array<Record<string, unknown>>
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows required' })

  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const r of rows) {
      await client.query(
        `insert into orders(
          order_id,account_id,order_type,buyer_name,shipping_address,items,total_amount,
          ship_status,tracking_number,tracking_method,is_abnormal,abnormal_type,remark,
          settlement_status,paid_amount
        ) values (
          $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15
        )
        on conflict(order_id) do update set
          account_id=excluded.account_id,
          order_type=excluded.order_type,
          buyer_name=excluded.buyer_name,
          shipping_address=excluded.shipping_address,
          items=excluded.items,
          total_amount=excluded.total_amount,
          ship_status=excluded.ship_status,
          tracking_number=excluded.tracking_number,
          tracking_method=excluded.tracking_method,
          is_abnormal=excluded.is_abnormal,
          abnormal_type=excluded.abnormal_type,
          remark=excluded.remark,
          settlement_status=excluded.settlement_status,
          paid_amount=excluded.paid_amount`,
        [
          r.order_id,
          r.account_id,
          r.order_type,
          r.buyer_name,
          r.shipping_address,
          JSON.stringify(r.items ?? []),
          r.total_amount ?? 0,
          r.ship_status ?? 'pending',
          r.tracking_number ?? null,
          r.tracking_method ?? null,
          r.is_abnormal ?? false,
          r.abnormal_type ?? null,
          r.remark ?? null,
          r.settlement_status ?? null,
          r.paid_amount ?? 0,
        ]
      )
    }
    await client.query('commit')
    res.json({ ok: true, count: rows.length })
  } catch (err) {
    await client.query('rollback')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

app.post('/api/push-subscriptions', requireAuth, async (req, res) => {
  const { endpoint, p256dh, auth } = req.body
  const { rows } = await pool.query(
    `insert into push_subscriptions(endpoint,p256dh,auth)
     values($1,$2,$3)
     on conflict(endpoint) do update set p256dh=excluded.p256dh, auth=excluded.auth
     returning *`,
    [endpoint, p256dh, auth]
  )
  res.json(rows[0])
})

app.listen(port, () => {
  console.log(`backend running on http://localhost:${port}`)
})

