<script setup>
const emit = defineEmits(['enter-building'])
const props = defineProps({
  initialPlayerPosition: { type: Object, default: null },
})
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getCampusInteriorData } from '../data/campus/campusInteriors.js'
import {
  CAMPUS_PLAYER_SPAWN_PIXEL,
  getCampusFootprintBounds,
  pointInCampusArea,
  pointInCampusPolygon,
  circleIntersectsCampusPolygon,
} from '../data/campus/campusLayout.js'
import { getCampusSpatialLayers } from '../data/campus/campusGeoJSON.js'

// Canvas 2D 与 Three.js 共用同一组从统一 FeatureCollection 派生的空间图层。
const { boundary: CAMPUS_BOUNDARY, gates: CAMPUS_GATES, areas: CAMPUS_AREAS, roads: CAMPUS_ROAD_CENTERLINES, buildings: CAMPUS_BUILDING_FOOTPRINTS } = getCampusSpatialLayers()
const CAMPUS_ROAD_WIDTHS = Object.fromEntries(CAMPUS_ROAD_CENTERLINES.map(road => [road.id, road.width]))

const canvas = ref(null)
const selected = ref(null)
const hovered = ref(null)
const zoom = ref(1)
const showReferenceImage = ref(true)
const referenceOpacity = ref(0.88)
const vectorAlignment = ref({ x: 0, y: 0, scale: 1 })
const showVectorOverlay = ref(true)
const showBuildingFootprints = ref(false)
const mapOffset = ref({ x: 0, y: 0 })
const viewport = ref({ width: 0, height: 0 })
let resizeObserver
let dragState = null
let dpr = 1
let baseMapCanvas = null
// 直接加载公开指南中的校园原始平面图，作为真实布局底图；矢量层用于后续逐项校准。
const referenceMapImage = new Image()
let referenceMapReady = false
referenceMapImage.onload = () => {
  referenceMapReady = true
  baseMapCanvas = null
  render()
}
referenceMapImage.onerror = () => {
  referenceMapReady = false
  render()
}
const pressedMovementKeys = new Set()
let movementFrameId = 0
let lastMovementFrameTime = 0
const selectedTitle = computed(() => selected.value?.label || selected.value?.name || '校园')
const initialX = Number(props.initialPlayerPosition?.x)
const initialY = Number(props.initialPlayerPosition?.y)
const player = ref({
  x: Number.isFinite(initialX) ? initialX : CAMPUS_PLAYER_SPAWN_PIXEL[0],
  y: Number.isFinite(initialY) ? initialY : CAMPUS_PLAYER_SPAWN_PIXEL[1],
  direction: 'down', walkFrame: 0,
})
// 按时间步进而不是依赖键盘自动重复频率，确保不同系统下移动速度一致。
const PLAYER_SPEED = 108 // 地图像素 / 秒
const palette = {
  grass: '#a9c78b', grassLight: '#b8d49a', grassDark: '#91b477',
  roadEdge: '#87977b', road: '#d9c99f', roadMark: '#eee3c7',
  water: '#76b8c0', waterEdge: '#4f929b', island: '#a8c88a',
  buildingSide: '#a66f50', building: '#d99b70', roof: '#bd7659',
  roofLight: '#e5ae7f', window: '#526d72', windowLight: '#d5d6a0',
  ink: '#354a40', label: '#405648',
}

function roundedRect(ctx, x, y, w, h, r = 3) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
function polygon(ctx, points) {
  if (!points?.length) return
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
}
function drawRoads(ctx) {
  for (const road of CAMPUS_ROAD_CENTERLINES) {
    const pts = road.points
    const roadWidth = CAMPUS_ROAD_WIDTHS[road.id] || 12
    ctx.lineCap = 'square'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))

    // 现代校园道路：灰色路缘、混凝土人行边带、深灰柏油路面。
    ctx.strokeStyle = '#89978c'
    ctx.lineWidth = roadWidth
    ctx.stroke()
    ctx.strokeStyle = '#c2c8bb'
    ctx.lineWidth = roadWidth * .82
    ctx.stroke()
    ctx.strokeStyle = '#687579'
    ctx.lineWidth = roadWidth * .56
    ctx.stroke()

    // 低频白色虚线作为道路中心标线，保留像素游戏的简洁表达。
    ctx.strokeStyle = '#e4e8df'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 9])
    ctx.stroke()
    ctx.setLineDash([])

    // 人行边带使用短缝线表达混凝土铺装，不再使用石板/土路纹理。
    ctx.strokeStyle = 'rgba(238, 241, 230, .42)'
    ctx.lineWidth = 1
    ctx.setLineDash([1, 15])
    ctx.stroke()
    ctx.setLineDash([])
  }
}
function drawCampusBoundary(ctx) {
  const ring = CAMPUS_BOUNDARY?.geometry?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return
  ctx.save()
  ctx.setLineDash([10, 6])
  ctx.strokeStyle = 'rgba(245, 248, 232, .95)'
  ctx.lineWidth = 2
  polygon(ctx, ring.slice(0, -1))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

function drawCampusGates(ctx) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.font = 'bold 10px "Noto Sans SC", sans-serif'
  for (const gate of CAMPUS_GATES) {
    const [x, y] = gate.position
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#f4d66d'
    ctx.fill()
    ctx.strokeStyle = '#354a40'
    ctx.lineWidth = 1.5
    ctx.stroke()
    const label = `${gate.name} · 待核位`
    const width = ctx.measureText(label).width + 8
    roundedRect(ctx, x - width / 2, y - 22, width, 13, 3)
    ctx.fillStyle = 'rgba(250, 248, 228, .96)'
    ctx.fill()
    ctx.fillStyle = '#354a40'
    ctx.fillText(label, x, y - 11)
  }
  ctx.restore()
}

function drawAreas(ctx) {
  for (const area of CAMPUS_AREAS) {
    if (area.type === 'water' && area.polygon) {
      polygon(ctx, area.polygon)
      ctx.fillStyle = palette.waterEdge
      ctx.fill()
      ctx.save()
      ctx.translate(0, -2)
      polygon(ctx, area.polygon.map(([x, y]) => [x, y]))
      ctx.fillStyle = palette.water
      ctx.fill()
      // 浅色岸线与断续像素岸石，强化水陆边界。
      ctx.strokeStyle = '#b9d9c0'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.strokeStyle = '#4f929b'
      ctx.lineWidth = 1
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // 水岸像素石块与浅滩色块，全部沿岸线稀疏布置。
      ctx.fillStyle = '#d7d7b0'
      for (let i = 0; i < area.polygon.length; i += 2) {
        const [x, y] = area.polygon[i]
        ctx.fillRect(Math.round(x) - 2, Math.round(y) - 1, 4, 2)
      }
      if (area.holes?.length) {
        for (const hole of area.holes) {
          polygon(ctx, hole)
          ctx.fillStyle = palette.island
          ctx.fill()
        }
      }
      ctx.restore()
      ctx.save()
      ctx.globalAlpha = .35
      ctx.fillStyle = '#d8f0df'
      for (let i = 0; i < 14; i++) {
        const x = area.id === 'central-lake' ? 485 + (i * 29) % 115 : 174 + (i * 19) % 85
        const y = area.id === 'central-lake' ? 150 + (i * 37) % 150 : 72 + (i * 23) % 82
        ctx.fillRect(x, y, 5 + (i % 3) * 2, 2)
      }
      ctx.restore()
    }
    if (area.type === 'sports' && area.rect) {
      const [x1, y1, x2, y2] = area.rect
      // 运动场采用塑胶跑道 + 人工草坪的现代校园视觉表达。
      ctx.fillStyle = '#a86f61'
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
      ctx.fillStyle = '#648a68'
      ctx.fillRect(x1 + 7, y1 + 7, x2 - x1 - 14, y2 - y1 - 14)
      ctx.strokeStyle = '#e7e9d8'
      ctx.lineWidth = 1
      ctx.strokeRect(x1 + 4, y1 + 4, x2 - x1 - 8, y2 - y1 - 8)
      ctx.strokeRect(x1 + 10, y1 + 10, x2 - x1 - 20, y2 - y1 - 20)
      ctx.beginPath()
      ctx.moveTo((x1 + x2) / 2, y1 + 10)
      ctx.lineTo((x1 + x2) / 2, y2 - 10)
      ctx.stroke()
      ctx.beginPath()
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) * .12, (y2 - y1) * .1, 0, 0, Math.PI * 2)
      ctx.stroke()
      // 跑道分道线只绘制在外圈，避免压到草坪区域。
      ctx.strokeStyle = 'rgba(246, 226, 211, .72)'
      for (let lane = 0; lane < 2; lane++) {
        ctx.strokeRect(x1 + 2 + lane * 2, y1 + 2 + lane * 2, x2 - x1 - 4 - lane * 4, y2 - y1 - 4 - lane * 4)
      }
    }
  }
}
function drawGround(ctx) {
  // 优先显示指南原始校园平面图，避免当前近似矢量数据掩盖真实布局。
  ctx.fillStyle = '#eeeee7'
  ctx.fillRect(0, 0, 1000, 500)
  if (showReferenceImage.value && referenceMapReady && referenceMapImage.naturalWidth > 0) {
    ctx.save()
    ctx.globalAlpha = referenceOpacity.value
    ctx.drawImage(referenceMapImage, 0, 0, 1000, 500)
    ctx.restore()
  }
  ctx.strokeStyle = '#c8c9bd'
  ctx.lineWidth = 1
  ctx.strokeRect(153, 49, 691, 417)
}
const BUILDING_ROOF_SETS = [
    { base: '#89999b', light: '#cbd5d0', dark: '#52666b' },
    { base: '#7d9299', light: '#c0d2d4', dark: '#4c626b' },
    { base: '#9ba9a4', light: '#d7ddd2', dark: '#61716e' },
    { base: '#87949a', light: '#c7d0d1', dark: '#53646b' },
  ]
function drawBuilding(ctx, building) {
  const bounds = getCampusFootprintBounds(building)
  if (!bounds) return
  const footprint = building.polygon || [
    [bounds[0], bounds[1]], [bounds[2], bounds[1]],
    [bounds[2], bounds[3]], [bounds[0], bounds[3]],
  ]
  // 当前阶段只表达建筑真实占地轮廓，不虚构屋顶、窗户、楼层和入口。
  polygon(ctx, footprint)
  ctx.fillStyle = 'rgba(111, 119, 112, .28)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(54, 68, 59, .78)'
  ctx.lineWidth = 1.1
  ctx.stroke()
  if (building.confidence === 'low') {
    ctx.save()
    ctx.strokeStyle = '#a47b4e'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 2])
    polygon(ctx, footprint)
    ctx.stroke()
    ctx.restore()
  }
}
function drawLabels(ctx) {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 9px "Noto Sans SC", sans-serif'
  const labels = [
    ['中央湖区', 544, 222], ['西侧湖区', 219, 119],
    ['东北运动场', 801, 166], ['南部运动场', 475, 455],
  ]
  for (const [text, x, y] of labels) {
    ctx.fillStyle = 'rgba(250,246,220,.9)'
    roundedRect(ctx, x - 31, y - 7, 62, 14, 2)
    ctx.fill()
    ctx.fillStyle = palette.label
    ctx.fillText(text, x, y)
  }
}
function mapToScreen() {
  const width = viewport.value.width, height = viewport.value.height
  const baseScale = Math.min((width - 36) / 1000, (height - 36) / 500)
  const scale = baseScale * zoom.value
  const x = (width - 1000 * scale) / 2 + mapOffset.value.x
  const y = (height - 500 * scale) / 2 + mapOffset.value.y
  return { scale, x, y }
}
function followPlayerCamera() {
  const width = viewport.value.width, height = viewport.value.height
  if (!width || !height) return
  const { scale } = mapToScreen()
  const baseX = (width - 1000 * scale) / 2
  const baseY = (height - 500 * scale) / 2
  // 角色保持在视口中心；地图边缘到达屏幕边缘后停止跟随，避免露出空白区域。
  const minX = 18 - baseX
  const maxX = width - 18 - 1000 * scale - baseX
  const minY = 18 - baseY
  const maxY = height - 18 - 500 * scale - baseY
  const desiredX = width / 2 - baseX - player.value.x * scale
  const desiredY = height / 2 - baseY - player.value.y * scale
  mapOffset.value = {
    x: minX <= maxX ? Math.max(minX, Math.min(maxX, desiredX)) : 0,
    y: minY <= maxY ? Math.max(minY, Math.min(maxY, desiredY)) : 0,
  }
}
function buildBaseMap() {
  if (baseMapCanvas) return
  baseMapCanvas = document.createElement('canvas')
  baseMapCanvas.width = 1000
  baseMapCanvas.height = 500
  const ctx = baseMapCanvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  drawGround(ctx)
  // 近似矢量层可独立开关，便于直接与原始参考图比对。
  if (showVectorOverlay.value) {
    ctx.save()
    // 允许在原图坐标系内微调矢量层，解决参考图裁切/缩放差异造成的整体偏移。
    ctx.translate(500 + vectorAlignment.value.x, 250 + vectorAlignment.value.y)
    ctx.scale(vectorAlignment.value.scale, vectorAlignment.value.scale)
    ctx.translate(-500, -250)
    ctx.globalAlpha = 0.22
    drawAreas(ctx)
    drawRoads(ctx)
    drawLabels(ctx)
    ctx.globalAlpha = 1
    drawCampusBoundary(ctx)
    drawCampusGates(ctx)
    ctx.restore()
  }
}
function render() {
  const el = canvas.value
  if (!el || !viewport.value.width || !viewport.value.height) return
  buildBaseMap()
  const ctx = el.getContext('2d')
  const width = viewport.value.width, height = viewport.value.height
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#d8dfc4'
  ctx.fillRect(0, 0, width, height)
  const { scale, x, y } = mapToScreen()
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = false
  if (baseMapCanvas) ctx.drawImage(baseMapCanvas, 0, 0)
  // 只构建当前视口可见对象的深度队列，减少缩放/移动时的无效绘制。
  const visibleBounds = {
    left: Math.max(0, -x / scale - 16),
    top: Math.max(0, -y / scale - 16),
    right: Math.min(1000, (width - x) / scale + 16),
    bottom: Math.min(500, (height - y) / scale + 16),
  }
  // 将视口范围反算回未变换的校园坐标，确保平移/缩放矢量层后建筑仍正确参与视口裁剪。
  const alignment = vectorAlignment.value
  const inversePoint = (px, py) => ({
    x: (px - 500 - alignment.x) / alignment.scale + 500,
    y: (py - 250 - alignment.y) / alignment.scale + 250,
  })
  const visibleCorners = [
    inversePoint(visibleBounds.left, visibleBounds.top),
    inversePoint(visibleBounds.right, visibleBounds.top),
    inversePoint(visibleBounds.right, visibleBounds.bottom),
    inversePoint(visibleBounds.left, visibleBounds.bottom),
  ]
  visibleBounds.left = Math.max(0, Math.min(...visibleCorners.map(point => point.x)))
  visibleBounds.top = Math.max(0, Math.min(...visibleCorners.map(point => point.y)))
  visibleBounds.right = Math.min(1000, Math.max(...visibleCorners.map(point => point.x)))
  visibleBounds.bottom = Math.min(500, Math.max(...visibleCorners.map(point => point.y)))
  const depthQueue = []
  ctx.save()
  ctx.translate(500 + vectorAlignment.value.x, 250 + vectorAlignment.value.y)
  ctx.scale(vectorAlignment.value.scale, vectorAlignment.value.scale)
  ctx.translate(-500, -250)
  if (showBuildingFootprints.value) CAMPUS_BUILDING_FOOTPRINTS.forEach((building, index) => {
    const bounds = getCampusFootprintBounds(building)
    if (!bounds || bounds[2] < visibleBounds.left || bounds[0] > visibleBounds.right
      || bounds[3] < visibleBounds.top || bounds[1] > visibleBounds.bottom) return
    // 建筑以 footprint 最南侧作为深度锚点；绘制整个建筑单元，保持屋顶与立面完整。
    depthQueue.push({
      depth: bounds[3] + 1,
      draw: () => {
        ctx.save()
        ctx.globalAlpha = 0.38
        drawBuilding(ctx, building)
        ctx.restore()
      },
    })
  })
  depthQueue.sort((a, b) => a.depth - b.depth)
  for (const item of depthQueue) item.draw()
  for (const [target, color, lineWidth] of [[hovered.value, '#fff8cf', 1.5], [selected.value, '#f6d66e', 2.5]]) {
    if (target?.type !== 'building') continue
    const item = CAMPUS_BUILDING_FOOTPRINTS.find(b => b.id === target.id)
    if (!item) continue
    const [l, t, r, b] = getCampusFootprintBounds(item) || [0, 0, 0, 0]
    const footprint = item.polygon || [[l - 2, t - 2], [r + 2, t - 2], [r + 2, b + 2], [l - 2, b + 2]]
    ctx.fillStyle = target === selected.value ? 'rgba(255,231,142,.12)' : 'rgba(255,255,220,.08)'
    polygon(ctx, footprint)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth / scale
    ctx.setLineDash(target === selected.value ? [] : [3 / scale, 2 / scale])
    polygon(ctx, item.polygon || [[l - 3, t - 4], [r + 3, t - 4], [r + 3, b + 4], [l - 3, b + 4]])
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
  ctx.restore()
}
function resize() {
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return
  viewport.value = { width: rect.width, height: rect.height }
  dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  canvas.value.width = Math.round(rect.width * dpr)
  canvas.value.height = Math.round(rect.height * dpr)
  render()
}
function drawExplorerCharacter(ctx, actor) {
  const { x, y, direction } = actor
  ctx.save()
  ctx.translate(x, y)
  // 像素角色采用独立阴影、身体和朝向细节绘制，保持缩放时的像素边缘。
  ctx.fillStyle = 'rgba(39, 55, 43, .28)'
  ctx.fillRect(-6, 5, 13, 4)
  ctx.fillStyle = '#344c43'
  const step = actor.walkFrame % 2 === 0 ? 1 : -1
  if (actor.walking) {
    ctx.fillRect(-4 + step, 1, 3, 5)
    ctx.fillRect(2 - step, 1, 3, 5)
  } else {
    ctx.fillRect(-4, 1, 3, 5)
    ctx.fillRect(2, 1, 3, 5)
  }
  ctx.fillStyle = '#e8c59b'
  ctx.fillRect(-5, -7, 10, 8)
  ctx.fillStyle = '#4f6f86'
  ctx.fillRect(-6, -1, 12, 7)
  ctx.fillStyle = '#d9e4d9'
  ctx.fillRect(-5, 0, 10, 2)
  ctx.fillStyle = '#bd815d'
  ctx.fillRect(-5, -12, 10, 6)
  ctx.fillStyle = '#e5ad7b'
  ctx.fillRect(-4, -14, 8, 4)
  ctx.fillStyle = '#344a40'
  ctx.fillRect(-3, -10, 2, 2)
  ctx.fillRect(2, -10, 2, 2)
  ctx.fillStyle = '#f2d47d'
  ctx.fillRect(-2, -15, 5, 2)
  if (direction === 'left') ctx.fillRect(-6, -9, 2, 3)
  if (direction === 'right') ctx.fillRect(5, -9, 2, 3)
  if (direction === 'up') {
    ctx.fillStyle = '#bd815d'
    ctx.fillRect(-4, -13, 8, 2)
  }
  ctx.restore()
}
function canPlayerMoveTo(x, y) {
  if (x < 8 || x > 992 || y < 8 || y > 492) return false

  // 角色不是一个无面积的点：用五点采样近似角色脚底碰撞体，减少贴墙穿模。
  const radiusX = 4
  const radiusY = 3
  const samples = [
    [x, y],
    [x - radiusX, y],
    [x + radiusX, y],
    [x, y - radiusY],
    [x, y + radiusY],
  ]

  for (const building of CAMPUS_BUILDING_FOOTPRINTS) {
    const [left, top, right, bottom] = getCampusFootprintBounds(building) || [0, 0, 0, 0]
    const blocked = building.polygon
      ? circleIntersectsCampusPolygon([x, y], Math.hypot(radiusX, radiusY), building.polygon)
      : x + radiusX >= left - 2 && x - radiusX <= right + 2
        && y + radiusY >= top - 2 && y - radiusY <= bottom + 2
    if (blocked) return false
  }

  return !CAMPUS_AREAS.some(area =>
    area.type === 'water' &&
    samples.some(point =>
      pointInCampusPolygon(point, area.polygon) &&
      !(area.holes || []).some(hole => pointInCampusPolygon(point, hole))
    )
  )
}
const MOVEMENT_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'])

function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
}

function startMovementKey(key) {
  if (!MOVEMENT_KEYS.has(key)) return
  pressedMovementKeys.add(key)
  if (!movementFrameId) {
    lastMovementFrameTime = 0
    movementFrameId = requestAnimationFrame(updateExplorerMovement)
  }
}

function stopMovementKey(key) {
  pressedMovementKeys.delete(key)
  if (!pressedMovementKeys.size) {
    player.value.walking = false
    render()
  }
}

function onExplorerKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return
  const key = event.key.toLowerCase()
  if (!MOVEMENT_KEYS.has(key)) return
  event.preventDefault()
  startMovementKey(key)
}

function onExplorerKeyup(event) {
  stopMovementKey(event.key.toLowerCase())
}

function onTouchMovementStart(key, event) {
  event.preventDefault()
  event.currentTarget.setPointerCapture?.(event.pointerId)
  startMovementKey(key)
}

function onTouchMovementEnd(key) {
  stopMovementKey(key)
}

function updateExplorerMovement(timestamp) {
  movementFrameId = 0
  if (!pressedMovementKeys.size) {
    lastMovementFrameTime = 0
    player.value.walking = false
    render()
    return
  }

  // 首帧只建立时间基准；单帧最大步长限制为 50ms，避免切后台后角色瞬移。
  const delta = lastMovementFrameTime ? Math.min((timestamp - lastMovementFrameTime) / 1000, 0.05) : 0
  lastMovementFrameTime = timestamp
  const up = pressedMovementKeys.has('arrowup') || pressedMovementKeys.has('w')
  const down = pressedMovementKeys.has('arrowdown') || pressedMovementKeys.has('s')
  const left = pressedMovementKeys.has('arrowleft') || pressedMovementKeys.has('a')
  const right = pressedMovementKeys.has('arrowright') || pressedMovementKeys.has('d')
  let dx = Number(right) - Number(left)
  let dy = Number(down) - Number(up)

  if (dx || dy) {
    const length = Math.hypot(dx, dy)
    dx /= length
    dy /= length
    if (Math.abs(dx) > Math.abs(dy)) player.value.direction = dx < 0 ? 'left' : 'right'
    else player.value.direction = dy < 0 ? 'up' : 'down'

    const distance = PLAYER_SPEED * delta
    const nextX = player.value.x + dx * distance
    const nextY = player.value.y + dy * distance
    const previousX = player.value.x
    const previousY = player.value.y
    // 分轴碰撞检测允许角色沿墙滑动，不会因斜向碰撞完全卡死。
    if (canPlayerMoveTo(nextX, player.value.y)) player.value.x = nextX
    if (canPlayerMoveTo(player.value.x, nextY)) player.value.y = nextY
    player.value.walking = player.value.x !== previousX || player.value.y !== previousY
    if (player.value.walking) {
      player.value.walkFrame++
      selected.value = null
      followPlayerCamera()
    }
  } else {
    player.value.walking = false
  }

  render()
  movementFrameId = requestAnimationFrame(updateExplorerMovement)
}

function clearMovementInput() {
  pressedMovementKeys.clear()
  if (movementFrameId) cancelAnimationFrame(movementFrameId)
  movementFrameId = 0
  lastMovementFrameTime = 0
  if (player.value.walking) {
    player.value.walking = false
    render()
  }
}
function pointerPosition(event) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
function hitTest(screenPoint) {
  const { scale, x, y } = mapToScreen()
  const screenX = (screenPoint.x - x) / scale
  const screenY = (screenPoint.y - y) / scale
  const alignment = vectorAlignment.value
  const px = (screenX - 500 - alignment.x) / alignment.scale + 500
  const py = (screenY - 250 - alignment.y) / alignment.scale + 250
  for (const building of CAMPUS_BUILDING_FOOTPRINTS) {
    const [l, t, r, b] = getCampusFootprintBounds(building) || [0, 0, 0, 0]
    const inside = building.polygon
      ? pointInCampusPolygon([px, py], building.polygon)
      : px >= l - 3 && px <= r + 3 && py >= t - 4 && py <= b + 3
    if (inside) return { type: 'building', id: building.id, label: building.label, confidence: building.confidence }
  }
  for (const area of CAMPUS_AREAS) {
    if (pointInCampusArea([px, py], area)) return { type: area.type, id: area.id, name: area.name, confidence: area.confidence }
  }
  return null
}
function onPointerDown(event) {
  if (event.button !== 0) return
  canvas.value.setPointerCapture(event.pointerId)
  dragState = { ...pointerPosition(event), origin: { ...mapOffset.value }, moved: false }
}
function onPointerMove(event) {
  if (!dragState) {
    const nextHover = hitTest(pointerPosition(event))
    if (nextHover?.id !== hovered.value?.id || nextHover?.type !== hovered.value?.type) {
      hovered.value = nextHover
      render()
    }
    return
  }
  const point = pointerPosition(event)
  const dx = point.x - dragState.x, dy = point.y - dragState.y
  if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true
  if (dragState.moved) {
    mapOffset.value = { x: dragState.origin.x + dx, y: dragState.origin.y + dy }
    render()
  }
}
function onPointerUp(event) {
  if (!dragState) return
  if (!dragState.moved) {
    selected.value = hitTest(pointerPosition(event))
    hovered.value = selected.value
    render()
  }
  dragState = null
}
function onPointerLeave() {
  if (dragState) return
  if (hovered.value) {
    hovered.value = null
    render()
  }
}
function onWheel(event) {
  event.preventDefault()
  const anchor = pointerPosition(event)
  const previous = mapToScreen()
  const nextZoom = Math.max(.72, Math.min(3.2, zoom.value * (event.deltaY < 0 ? 1.12 : .89)))
  if (nextZoom === zoom.value) return

  // 以鼠标所在地图点为缩放锚点，缩放时不让目标位置漂移。
  const mapX = (anchor.x - previous.x) / previous.scale
  const mapY = (anchor.y - previous.y) / previous.scale
  zoom.value = nextZoom
  const nextScale = mapToScreen().scale
  const width = viewport.value.width, height = viewport.value.height
  mapOffset.value = {
    x: anchor.x - (width - 1000 * nextScale) / 2 - mapX * nextScale,
    y: anchor.y - (height - 500 * nextScale) / 2 - mapY * nextScale,
  }
  render()
}
function openShowcase() {
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'showcase')
  window.location.assign(url)
}
function resetView() { zoom.value = 1; mapOffset.value = { x: 0, y: 0 }; render() }
function zoomBy(value) { zoom.value = Math.max(.72, Math.min(3.2, zoom.value * value)); render() }
onMounted(() => {
  referenceMapImage.src = 'https://mmbiz.qpic.cn/sz_mmbiz_jpg/I7CrcZW85viauJhPE5oxIic650acadic3zicLbM1kQ4eHcz4fbdYMNw0QliaiapzFkyBOakxlRcZINmMyD2DO1ib6Da2agZD6iaKM9RhmA1mkh3H8Pc/640?from=appmsg&wx_fmt=jpeg'
  resizeObserver = new ResizeObserver(resize)
  if (canvas.value) resizeObserver.observe(canvas.value)
  window.addEventListener('resize', resize)
  window.addEventListener('keydown', onExplorerKeydown)
  window.addEventListener('keyup', onExplorerKeyup)
  window.addEventListener('blur', clearMovementInput)
  resize()
  // 从室内返回时先恢复角色坐标，再将镜头定位到该坐标；避免角色落在视口边缘之外。
  if (props.initialPlayerPosition) {
    followPlayerCamera()
    render()
  }
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', resize)
  window.removeEventListener('keydown', onExplorerKeydown)
  window.removeEventListener('keyup', onExplorerKeyup)
  window.removeEventListener('blur', clearMovementInput)
  clearMovementInput()
})
</script>

<template>
  <section class="pixel-campus">
    <header class="pixel-header">
      <div class="pixel-brand">
        <div class="pixel-emblem">NC</div>
        <div><strong>南昌工学院</strong><span>NANCHANG INSTITUTE OF TECHNOLOGY</span></div>
      </div>
      <div class="pixel-header-actions">
        <div class="pixel-header-tag"><i></i> 南昌工学院 · 校园平面图重建</div>
        <a href="?view=editor" class="pixel-build-link">进入校园建设 ↗</a>
        <a href="?view=showcase" class="pixel-explore-link">进入 2.5D 校园探索 ↗</a>
        <a href="https://app.gaokaozhitongche.com/newsguide/h/Rg1KJO0N" target="_blank" rel="noreferrer" class="pixel-showcase-link">查看 2026 官方参考平面图 ↗</a>
      </div>
    </header>
    <canvas
      ref="canvas"
      class="pixel-map-canvas"
      :style="{ cursor: dragState ? 'grabbing' : hovered ? 'pointer' : 'grab' }"
      aria-label="南昌工学院二维像素校园地图，可拖动平移、滚轮缩放、点击建筑查看信息"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @wheel="onWheel"
      @contextmenu.prevent
    />
    <div style="position:absolute;top:18px;left:18px;z-index:3;display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(250,248,230,.92);border:1px solid rgba(76,96,70,.22);border-radius:7px;box-shadow:0 3px 12px rgba(48,65,48,.12);pointer-events:none;font-size:12px;color:#405648;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#6b9a60;box-shadow:0 0 0 3px rgba(107,154,96,.16);"></span>
      <strong>平面图模式</strong>
      <span style="opacity:.7;">{{ referenceMapReady ? '原始平面图已加载' : '原始平面图加载中 / 不可用' }} · 建筑候选尚未逐栋校准 · 矢量层仅供位置比对</span>
    </div>
    <div class="pixel-map-controls">
      <button :class="{ active: showReferenceImage }" @click="showReferenceImage = !showReferenceImage; baseMapCanvas = null; render()">原图</button>
      <button :class="{ active: showVectorOverlay }" @click="showVectorOverlay = !showVectorOverlay; baseMapCanvas = null; render()">道路/水域</button>
      <button :class="{ active: showBuildingFootprints }" @click="showBuildingFootprints = !showBuildingFootprints; render()">建筑候选（未校准）</button>
      <label style="display:flex;align-items:center;gap:6px;padding:0 8px;font-size:12px;color:#405648;white-space:nowrap;">原图透明度 <input v-model.number="referenceOpacity" type="range" min="0.15" max="1" step="0.05" style="width:88px;accent-color:#58765c;" @input="baseMapCanvas = null; render()" /> {{ Math.round(referenceOpacity * 100) }}%</label>
      <label style="display:flex;align-items:center;gap:5px;padding:0 6px;font-size:12px;color:#405648;white-space:nowrap;">矢量 X <input v-model.number="vectorAlignment.x" type="range" min="-80" max="80" step="1" style="width:64px;accent-color:#58765c;" @input="baseMapCanvas = null; render()" /></label>
      <label style="display:flex;align-items:center;gap:5px;padding:0 6px;font-size:12px;color:#405648;white-space:nowrap;">Y <input v-model.number="vectorAlignment.y" type="range" min="-80" max="80" step="1" style="width:64px;accent-color:#58765c;" @input="baseMapCanvas = null; render()" /></label>
      <label style="display:flex;align-items:center;gap:5px;padding:0 6px;font-size:12px;color:#405648;white-space:nowrap;">比例 <input v-model.number="vectorAlignment.scale" type="range" min="0.8" max="1.2" step="0.01" style="width:64px;accent-color:#58765c;" @input="baseMapCanvas = null; render()" />{{ Math.round(vectorAlignment.scale * 100) }}%</label>
      <button @click="vectorAlignment = { x: 0, y: 0, scale: 1 }; baseMapCanvas = null; render()">重置对齐</button>
      <button @click="zoomBy(1.2)" aria-label="放大">＋</button>
      <button @click="zoomBy(.84)" aria-label="缩小">－</button>
      <button @click="resetView">复位</button>
    </div>
    <div v-if="false" class="pixel-mobile-pad" aria-label="触屏方向控制">
      <button class="pixel-mobile-key pixel-key-up" aria-label="向上移动" @pointerdown="onTouchMovementStart('arrowup', $event)" @pointerup="onTouchMovementEnd('arrowup')" @pointercancel="onTouchMovementEnd('arrowup')" @lostpointercapture="onTouchMovementEnd('arrowup')">▲</button>
      <button class="pixel-mobile-key pixel-key-left" aria-label="向左移动" @pointerdown="onTouchMovementStart('arrowleft', $event)" @pointerup="onTouchMovementEnd('arrowleft')" @pointercancel="onTouchMovementEnd('arrowleft')" @lostpointercapture="onTouchMovementEnd('arrowleft')">◀</button>
      <button class="pixel-mobile-key pixel-key-down" aria-label="向下移动" @pointerdown="onTouchMovementStart('arrowdown', $event)" @pointerup="onTouchMovementEnd('arrowdown')" @pointercancel="onTouchMovementEnd('arrowdown')" @lostpointercapture="onTouchMovementEnd('arrowdown')">▼</button>
      <button class="pixel-mobile-key pixel-key-right" aria-label="向右移动" @pointerdown="onTouchMovementStart('arrowright', $event)" @pointerup="onTouchMovementEnd('arrowright')" @pointercancel="onTouchMovementEnd('arrowright')" @lostpointercapture="onTouchMovementEnd('arrowright')">▶</button>
    </div>
    <div class="pixel-map-legend"><span><i class="legend-building"></i> 建筑</span><span><i class="legend-water"></i> 湖泊</span><span><i class="legend-road"></i> 道路</span><span><i class="legend-sports"></i> 运动场</span></div>
    <aside v-if="selected" class="pixel-selection">
      <button class="pixel-selection-close" aria-label="关闭" @click="selected = null; render()">×</button>
      <small>校园地点 / CAMPUS PLACE</small>
      <strong>{{ selectedTitle }}</strong>
      <span>{{ selected.type === 'building' ? '建筑轮廓' : selected.type === 'water' ? '湖泊水域' : selected.type === 'sports' ? '运动场地' : '校园区域' }}</span>
      <em>位置数据：{{ selected.confidence === 'low' ? '待核验' : '近似标注' }}</em>
      
    </aside>
    <footer class="pixel-footer"><span>NCGXY · CAMPUS PLAN / V1</span><span>底图来源：2026 级新生报到指南 · 拖动浏览 / 滚轮缩放 · 建筑与道路位置持续校准</span></footer>
  </section>
</template>
