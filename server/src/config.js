import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
dotenv.config()

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(v => v.trim()),
  authMode: process.env.AUTH_MODE || 'external',
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ncgxy_campus_map',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  },
}
if (env.nodeEnv === 'production' && env.authMode === 'development') {
  throw new Error('生产环境禁止使用 AUTH_MODE=development')
}
export const pool = mysql.createPool({
  ...env.database, waitForConnections: true, queueLimit: 0,
  charset: 'utf8mb4', decimalNumbers: true,
})
export async function checkDatabase() {
  const [rows] = await pool.query('SELECT 1 AS ok')
  return rows[0]?.ok === 1
}
