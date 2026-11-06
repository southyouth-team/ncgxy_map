import { CAMPUS_BUILDING_FOOTPRINTS, CAMPUS_ROAD_CENTERLINES } from './campusLayout.js'

const GUIDE_SOURCE = '南昌工学院2026级新生报到指南·校园平面图'
const GUIDE_URL = 'https://app.gaokaozhitongche.com/newsguide/h/Rg1KJO0N'
const OFFICIAL_CAMPUS_URL = 'https://zsb.ncpu.edu.cn/xiaoyuansh/meilixiaoyuan/'

/**
 * 校园边界当前是公开导览图的人工描绘范围，不是权属红线或测绘边界。
 * 坐标位于 1000×500 参考图像像素系，精度低，待现场/正射影像控制点校准。
 */
export const CAMPUS_BOUNDARY = Object.freeze({
  id: 'campus-boundary-reference',
  name: '校园边界（导览图近似描绘）',
  polygon: [[155, 58], [824, 58], [840, 84], [840, 430], [812, 458], [184, 458], [155, 432]],
  confidence: 'low',
  verificationStatus: 'unverified',
  boundaryStatus: 'reference-outline-not-surveyed',
  source: GUIDE_SOURCE,
  sourceUrl: GUIDE_URL,
})

/**
 * 东门、南门名称与通行方式来自 2026 新生报到指南。
 * 位置是根据公开平面图边缘的人工估读点，不代表门禁中心或精确坐标。
 */
export const CAMPUS_GATES = Object.freeze([
  {
    id: 'gate-east',
    name: '东门',
    position: [839, 246],
    accessModes: ['迎新车辆', '校车', '步行'],
    confidence: 'low',
    verificationStatus: 'unverified',
    positionNote: '按导览图东侧出入口估读；需现场核验',
    source: GUIDE_SOURCE,
    sourceUrl: GUIDE_URL,
  },
  {
    id: 'gate-south',
    name: '南门',
    position: [620, 458],
    accessModes: ['私家车', '出租车', '步行'],
    confidence: 'low',
    verificationStatus: 'unverified',
    positionNote: '按导览图南侧出入口估读；需现场核验',
    source: GUIDE_SOURCE,
    sourceUrl: GUIDE_URL,
  },
])

/**
 * 官方公开页面可确认名称，但暂未取得可可靠定位的坐标。
 * position / buildingId 保持 null，禁止将猜测坐标写入导航数据。
 */
export const CAMPUS_SITE_AREAS = Object.freeze([
  { id: 'site-area-large-lawn', name: '大草坪', category: 'green-space', geometry: null, geometryStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'site-area-plaza-north', name: null, category: 'plaza', geometry: null, geometryStatus: 'pending-name-and-location', source: GUIDE_URL },
  { id: 'site-area-plaza-south', name: null, category: 'plaza', geometry: null, geometryStatus: 'pending-name-and-location', source: GUIDE_URL },
])

export const CAMPUS_POIS = Object.freeze([
  { id: 'poi-zhiyuan-building', name: '致远楼', category: 'building', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-duxing-building', name: '笃行楼', category: 'building', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-library', name: '图书馆', category: 'library', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-canteen', name: '食堂', category: 'dining', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-ethnic-activity-center', name: '民族活动中心', category: 'activity-center', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-electronic-information-building', name: '电子信息楼', category: 'teaching', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-dormitory-cluster', name: '宿舍楼群', category: 'residential', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-jingming-bridge', name: '景明桥', category: 'bridge', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-wangyue-lake', name: '望月湖', category: 'water', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
  { id: 'poi-large-lawn', name: '大草坪', category: 'green-space', position: null, buildingId: null, nameStatus: 'source-confirmed', locationStatus: 'pending', source: OFFICIAL_CAMPUS_URL },
])

/**
 * 现有 footprint 是导览图上人工近似描绘的 53 个对象。
 * 暂不把“组团编号”伪装成学校正式楼栋编号；待逐栋核验后回填正式名称、用途和编号。
 */
export const CAMPUS_BUILDING_METADATA = Object.freeze(Object.fromEntries(
  CAMPUS_BUILDING_FOOTPRINTS.map((building) => [building.id, Object.freeze({
    canonicalName: null,
    buildingNumber: null,
    useType: 'unclassified',
    identityStatus: 'pending',
    footprintStatus: 'approximate',
    source: GUIDE_SOURCE,
  })]),
))

/**
 * 从道路中心线自动拆分路段并生成拓扑图。
 * 交叉点来自当前近似中心线的几何计算，拓扑仍需现场核验。
 */
export function buildCampusRoadGraph(roadFeatures = CAMPUS_ROAD_CENTERLINES.map(road => ({
  id: road.id,
  properties: { width: 12, confidence: road.confidence },
  geometry: { type: 'LineString', coordinates: road.points },
})), gateFeatures = CAMPUS_GATES.map(gate => ({
  id: gate.id,
  properties: { name: gate.name, confidence: gate.confidence },
  geometry: { type: 'Point', coordinates: gate.position },
}))) {
  const segments = []
  for (const feature of roadFeatures) {
    const points = feature.geometry?.coordinates || []
    for (let index = 0; index < points.length - 1; index++) {
      segments.push({
        roadId: feature.id,
        segmentIndex: index,
        a: points[index],
        b: points[index + 1],
        width: feature.properties?.width || 12,
        confidence: feature.properties?.confidence || 'low',
        splits: [0, 1],
      })
    }
  }

  const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
  for (let i = 0; i < segments.length; i++) {
    const first = segments[i]
    const r = [first.b[0] - first.a[0], first.b[1] - first.a[1]]
    for (let j = i + 1; j < segments.length; j++) {
      const second = segments[j]
      if (first.roadId === second.roadId && Math.abs(first.segmentIndex - second.segmentIndex) <= 1) continue
      const q = [second.a[0] - first.a[0], second.a[1] - first.a[1]]
      const s = [second.b[0] - second.a[0], second.b[1] - second.a[1]]
      const denominator = cross(r, s)
      if (Math.abs(denominator) < 1e-8) continue
      const t = cross(q, s) / denominator
      const u = cross(q, r) / denominator
      if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 &&
        (t > 1e-6 && t < 1 - 1e-6 || u > 1e-6 && u < 1 - 1e-6)) {
        first.splits.push(Math.max(0, Math.min(1, t)))
        second.splits.push(Math.max(0, Math.min(1, u)))
      }
    }
  }

  const gateProjections = gateFeatures.map(gate => {
    const point = gate.geometry?.coordinates
    if (!Array.isArray(point) || point.length < 2) return null
    let nearest = null
    for (const segment of segments) {
      const dx = segment.b[0] - segment.a[0]
      const dy = segment.b[1] - segment.a[1]
      const lengthSquared = dx * dx + dy * dy
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((point[0] - segment.a[0]) * dx + (point[1] - segment.a[1]) * dy) / lengthSquared))
        : 0
      const projected = [segment.a[0] + t * dx, segment.a[1] + t * dy]
      const distance = Math.hypot(point[0] - projected[0], point[1] - projected[1])
      if (!nearest || distance < nearest.distance) nearest = { segment, t, point: projected, distance }
    }
    if (!nearest || nearest.distance > 35) return null
    nearest.segment.splits.push(nearest.t)
    return { gate, gatePoint: point, segment: nearest.segment, t: nearest.t, projectedPoint: nearest.point, distance: nearest.distance }
  }).filter(Boolean)

  const nodes = new Map()
  const edges = []
  const nodeFor = point => {
    const x = Math.round(point[0] * 100) / 100
    const y = Math.round(point[1] * 100) / 100
    const key = `${x},${y}`
    if (!nodes.has(key)) nodes.set(key, { id: `road-node-${nodes.size + 1}`, position: [x, y], confidence: 'low' })
    return nodes.get(key)
  }

  for (const segment of segments) {
    const uniqueSplits = [...new Set(segment.splits.map(value => Math.round(value * 1e8) / 1e8))].sort((a, b) => a - b)
    for (let index = 0; index < uniqueSplits.length - 1; index++) {
      const fromT = uniqueSplits[index], toT = uniqueSplits[index + 1]
      const pointAt = t => [
        segment.a[0] + (segment.b[0] - segment.a[0]) * t,
        segment.a[1] + (segment.b[1] - segment.a[1]) * t,
      ]
      const from = nodeFor(pointAt(fromT)), to = nodeFor(pointAt(toT))
      const length = Math.hypot(to.position[0] - from.position[0], to.position[1] - from.position[1])
      if (length < 1e-6) continue
      edges.push({
        id: `${segment.roadId}-edge-${edges.length + 1}`,
        roadId: segment.roadId,
        from: from.id,
        to: to.id,
        length,
        width: segment.width,
        confidence: segment.confidence,
        direction: 'both',
        topologyStatus: 'derived-from-approximate-centerline',
      })
    }
  }

  const gateLinks = []
  for (const projection of gateProjections) {
    const gateNode = nodeFor(projection.gatePoint)
    const roadNode = nodeFor(projection.projectedPoint)
    const link = {
      id: `${projection.gate.id}-connector`,
      gateId: projection.gate.id,
      roadId: projection.segment.roadId,
      from: gateNode.id,
      to: roadNode.id,
      length: projection.distance,
      type: 'gate-connector',
      confidence: 'low',
      direction: 'both',
      topologyStatus: 'derived-from-approximate-gate-and-road-positions',
    }
    gateLinks.push(link)
    if (projection.distance > 0.01) edges.push(link)
    gateNode.gateId = projection.gate.id
  }
  return {
    nodes: [...nodes.values()],
    edges,
    gateLinks,
    status: 'approximate-needs-field-verification',
  }
}
