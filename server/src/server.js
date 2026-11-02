import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env, pool, checkDatabase } from './config.js'

const app = express()
const ok = (res, data = null, message = '操作成功', status = 200) =>
  res.status(status).json({ code: 0, message, data })
const error = (status, code, message) => Object.assign(new Error(message), { status, code })
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function auth(req, res, next) {
  // 正式集成时由宿主认证中间件设置 req.user = { id }。
  if (req.user?.id) return next()
  if (env.nodeEnv !== 'production' && env.authMode === 'development') {
    const id = req.get('X-Dev-User-Id')
    if (id && /^\d+$/.test(id) && BigInt(id) > 0n) {
      req.user = { id }
      return next()
    }
  }
  return res.status(401).json({ code: 40100, message: '未登录或身份认证未接入', data: null })
}
const positiveId = name => (req, res, next) => {
  const value = req.params[name]
  if (!/^\d+$/.test(String(value)) || BigInt(value) <= 0n) {
    return res.status(400).json({ code: 40001, message: `参数 ${name} 必须为正整数`, data: null })
  }
  next()
}
const slugify = value => String(value || '').trim().toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: env.corsOrigin, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.get('/health', (req, res) => ok(res, { service: 'ncgxy-campus-map-api', status: 'ok' }))
app.get('/ready', asyncRoute(async (req, res) => {
  await checkDatabase()
  return ok(res, { database: 'connected' })
}))

// 学校 DAO：所有数据访问均通过当前用户的成员关系进行范围约束。
const campusByUser = async (campusId, userId) => {
  const [rows] = await pool.query(
    `SELECT c.id,c.slug,c.name,c.description,c.address,c.status,cm.role,c.created_at,c.updated_at
       FROM campus c JOIN campus_member cm ON cm.campus_id=c.id
      WHERE c.id=? AND cm.user_id=? LIMIT 1`, [campusId, userId])
  return rows[0] || null
}
const listCampuses = async userId => {
  const [rows] = await pool.query(
    `SELECT c.id,c.slug,c.name,c.description,c.address,c.status,cm.role,c.created_at,c.updated_at
       FROM campus c JOIN campus_member cm ON cm.campus_id=c.id
      WHERE cm.user_id=? ORDER BY c.updated_at DESC,c.id DESC`, [userId])
  return rows
}
const canEdit = role => ['owner', 'admin', 'editor'].includes(role)

const api = express.Router()
api.get('/campuses', auth, asyncRoute(async (req, res) => ok(res, await listCampuses(req.user.id))))
api.post('/campuses', auth, asyncRoute(async (req, res) => {
  const body = req.body || {}
  if (!String(body.name || '').trim()) throw error(400, 40001, '学校名称不能为空')
  const slug = slugify(body.slug || body.name)
  if (!slug) throw error(400, 40002, '请提供有效 slug')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [created] = await conn.query(
      "INSERT INTO campus (slug,name,description,address,status,created_by) VALUES (?,?,?,?, 'active',?)",
      [slug, String(body.name).trim(), body.description || null, body.address || null, req.user.id])
    await conn.query("INSERT INTO campus_member (campus_id,user_id,role) VALUES (?,?, 'owner')", [created.insertId, req.user.id])
    await conn.commit()
    return ok(res, await campusByUser(created.insertId, req.user.id), '学校项目创建成功', 201)
  } catch (e) {
    await conn.rollback()
    if (e.code === 'ER_DUP_ENTRY') throw error(409, 40901, '学校 slug 已存在')
    throw e
  } finally { conn.release() }
}))
api.get('/campuses/:campusId', auth, positiveId('campusId'), asyncRoute(async (req, res) => {
  const data = await campusByUser(req.params.campusId, req.user.id)
  if (!data) throw error(404, 40401, '学校项目不存在或无访问权限')
  return ok(res, data)
}))
api.patch('/campuses/:campusId', auth, positiveId('campusId'), asyncRoute(async (req, res) => {
  const current = await campusByUser(req.params.campusId, req.user.id)
  if (!current) throw error(404, 40401, '学校项目不存在或无访问权限')
  if (!['owner', 'admin'].includes(current.role)) throw error(403, 40301, '没有管理学校项目的权限')
  const allowed = ['name', 'description', 'address', 'status']
  const sets = [], values = []
  for (const key of allowed) if (req.body?.[key] !== undefined) {
    if (key === 'name' && !String(req.body[key]).trim()) throw error(400, 40001, '学校名称不能为空')
    sets.push(`${key}=?`); values.push(key === 'name' ? String(req.body[key]).trim() : req.body[key])
  }
  if (sets.length) {
    values.push(req.params.campusId)
    await pool.query(`UPDATE campus SET ${sets.join(',')} WHERE id=?`, values)
  }
  return ok(res, await campusByUser(req.params.campusId, req.user.id), '学校项目更新成功')
}))

// 地图项目 CRUD。
api.get('/campuses/:campusId/maps', auth, positiveId('campusId'), asyncRoute(async (req, res) => {
  const campus = await campusByUser(req.params.campusId, req.user.id)
  if (!campus) throw error(404, 40401, '学校项目不存在或无访问权限')
  const [rows] = await pool.query(
    `SELECT id,campus_id,slug,name,description,coordinate_system,coordinate_unit,
            canvas_width,canvas_height,status,revision,created_at,updated_at
       FROM campus_map WHERE campus_id=? ORDER BY updated_at DESC,id DESC`, [req.params.campusId])
  return ok(res, rows)
}))
api.post('/campuses/:campusId/maps', auth, positiveId('campusId'), asyncRoute(async (req, res) => {
  const campus = await campusByUser(req.params.campusId, req.user.id)
  if (!campus) throw error(404, 40401, '学校项目不存在或无访问权限')
  if (!canEdit(campus.role)) throw error(403, 40301, '没有地图编辑权限')
  const body = req.body || {}
  if (!String(body.name || '').trim()) throw error(400, 40001, '地图名称不能为空')
  const slug = slugify(body.slug || body.name)
  if (!slug) throw error(400, 40002, '请提供有效地图 slug')
  try {
    const [created] = await pool.query(
      `INSERT INTO campus_map
       (campus_id,slug,name,description,coordinate_system,coordinate_unit,canvas_width,canvas_height,coordinate_config,status,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,'draft',?)`,
      [req.params.campusId,slug,String(body.name).trim(),body.description || null,
       body.coordinateSystem || 'campus-local',body.coordinateUnit || 'pixel',
       body.canvasWidth || 640,body.canvasHeight || 480,
       body.coordinateConfig ? JSON.stringify(body.coordinateConfig) : null,req.user.id])
    const [rows] = await pool.query('SELECT * FROM campus_map WHERE id=? AND campus_id=?', [created.insertId,req.params.campusId])
    return ok(res, rows[0], '地图项目创建成功', 201)
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw error(409, 40902, '当前学校下地图 slug 已存在')
    throw e
  }
}))
api.get('/campuses/:campusId/maps/:mapId', auth, positiveId('campusId'), positiveId('mapId'), asyncRoute(async (req, res) => {
  const campus = await campusByUser(req.params.campusId, req.user.id)
  if (!campus) throw error(404, 40401, '学校项目不存在或无访问权限')
  const [rows] = await pool.query(
    'SELECT * FROM campus_map WHERE campus_id=? AND id=? LIMIT 1', [req.params.campusId,req.params.mapId])
  if (!rows[0]) throw error(404, 40402, '地图项目不存在')
  return ok(res, rows[0])
}))
api.patch('/campuses/:campusId/maps/:mapId', auth, positiveId('campusId'), positiveId('mapId'), asyncRoute(async (req, res) => {
  const campus = await campusByUser(req.params.campusId, req.user.id)
  if (!campus) throw error(404, 40401, '学校项目不存在或无访问权限')
  if (!canEdit(campus.role)) throw error(403, 40301, '没有地图编辑权限')
  const [found] = await pool.query('SELECT * FROM campus_map WHERE campus_id=? AND id=? LIMIT 1', [req.params.campusId,req.params.mapId])
  const current = found[0]
  if (!current) throw error(404, 40402, '地图项目不存在')
  if (req.body?.revision !== undefined && Number(req.body.revision) !== Number(current.revision)) {
    throw Object.assign(error(409,40903,'地图数据已更新，请刷新后重试'),{details:{currentRevision:current.revision}})
  }
  const mapping = {name:'name',description:'description',coordinateSystem:'coordinate_system',coordinateUnit:'coordinate_unit',canvasWidth:'canvas_width',canvasHeight:'canvas_height',coordinateConfig:'coordinate_config'}
  const sets=[], values=[]
  for (const [key,column] of Object.entries(mapping)) if (req.body?.[key] !== undefined) {
    sets.push(`${column}=?`)
    values.push(key === 'coordinateConfig' && req.body[key] !== null ? JSON.stringify(req.body[key]) : req.body[key])
  }
  if (sets.length) {
    values.push(req.params.campusId,req.params.mapId,current.revision)
    const [updated] = await pool.query(
      `UPDATE campus_map SET ${sets.join(',')},revision=revision+1 WHERE campus_id=? AND id=? AND revision=?`, values)
    if (!updated.affectedRows) throw error(409,40903,'地图数据已更新，请刷新后重试')
  }
  const [rows] = await pool.query('SELECT * FROM campus_map WHERE campus_id=? AND id=?', [req.params.campusId,req.params.mapId])
  return ok(res, rows[0], '地图项目更新成功')
}))
app.use(env.apiPrefix, api)
app.use((req,res) => res.status(404).json({code:40400,message:'接口不存在',data:null}))
app.use((err,req,res,next) => {
  if (res.headersSent) return next(err)
  const status = Number(err.status || 500)
  if (status >= 500) console.error('[API ERROR]',err)
  return res.status(status).json({
    code:Number(err.code || (status >= 500 ? 50000 : 40000)),
    message:status >= 500 && env.nodeEnv === 'production' ? '服务器内部错误' : err.message,
    data:null, ...(err.details ? {details:err.details} : {}),
  })
})

const server = app.listen(env.port,'0.0.0.0',() => console.log(`[Campus Map API] listening on :${env.port}`))
async function shutdown(signal) {
  console.log(`[Campus Map API] received ${signal}`)
  server.close(async () => { await pool.end(); process.exit(0) })
  setTimeout(() => process.exit(1),10000).unref()
}
process.on('SIGINT',() => shutdown('SIGINT'))
process.on('SIGTERM',() => shutdown('SIGTERM'))
