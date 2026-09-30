import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT)    || 5432,
  database: process.env.PGDATABASE || 'd2d_portal',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
})

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error', err)
  process.exit(1)
})

// Verify DB connection on startup
pool.connect().then(client => {
  const { host, port, database, user } = pool.options
  console.log(`Database connected: postgresql://${user}@${host}:${port}/${database}`)
  client.release()
}).catch(err => {
  console.error('Database connection failed:', err.message)
  process.exit(1)
})

export default pool
