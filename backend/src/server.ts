import dotenv from 'dotenv'

import { createApp } from './createApp.js'
import { appMeta } from './appMeta.js'

dotenv.config()

const app = createApp()
const port = Number(process.env.PORT ?? 8787)

app.listen(port, () => {
  console.log(`${appMeta.displayName} backend running on http://localhost:${port}`)
})
