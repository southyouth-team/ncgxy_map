<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  CAMPUS_AREAS,
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_ROAD_CENTERLINES,
  CAMPUS_ROAD_WIDTHS,
  getCampusFootprintBounds,
  pointInCampusArea,
  pointInCampusPolygon,
} from '../data/campus/campusLayout.js'

const canvas = ref(null)
const selected = ref(null)
const hovered = ref(null)
const zoom = ref(1)
const mapOffset = ref({ x: 0, y: 0 })
const viewport = ref({ width: 0, height: 0 })
let resizeObserver
let dragState = null
let dpr = 1
let baseMapCanvas = null
const selectedTitle = computed(() => selected.value?.label || selected.value?.name || '校园')
const player = ref({ x: 640, y: 340, direction: 'down', walkFrame: 0 })
const PLAYER_SPEED = 3.2
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

    // 三层道路结构：草绿色路缘、浅色人行边带、暖灰色路面。
    ctx.strokeStyle = '#71866b'
    ctx.lineWidth = roadWidth
    ctx.stroke()
    ctx.strokeStyle = '#c6c99f'
    ctx.lineWidth = roadWidth * .8
    ctx.stroke()
    const isPerimeterRoad = road.id.includes('perimeter')
    ctx.strokeStyle = isPerimeterRoad ? '#d5c69e' : '#e2d4ad'
    ctx.lineWidth = roadWidth * (isPerimeterRoad ? .53 : .46)
    ctx.stroke()

    // 断续的像素路面标线，避免连续虚线造成现代公路感。
    ctx.strokeStyle = '#f4e8c8'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 7])
    ctx.stroke()
    ctx.setLineDash([])

    // 道路两侧的短段石板纹理，强化 RPG 地图的 tile 质感。
    ctx.fillStyle = '#a6ad88'
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]
      const length = Math.hypot(x2 - x1, y2 - y1)
      const steps = Math.floor(length / 24)
      for (let j = 1; j < steps; j++) {
        const t = j / steps
        const x = Math.round(x1 + (x2 - x1) * t)
        const y = Math.round(y1 + (y2 - y1) * t)
        ctx.fillRect(x - 6, y - 6, 2, 2)
        ctx.fillRect(x + 5, y + 5, 2, 2)
      }
    }
  }
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
      ctx.fillStyle = '#c77e69'
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
      ctx.strokeStyle = '#f1d6a9'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x1 + 4, y1 + 4, x2 - x1 - 8, y2 - y1 - 8)
      ctx.beginPath()
      ctx.moveTo((x1 + x2) / 2, y1 + 4)
      ctx.lineTo((x1 + x2) / 2, y2 - 4)
      ctx.stroke()
      ctx.beginPath()
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) * .13, (y2 - y1) * .1, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}
function drawGround(ctx) {
  ctx.fillStyle = palette.grass
  ctx.fillRect(0, 0, 1000, 500)

  // 低对比度草地 tile 纹理：保持大面积底色干净，近看有像素颗粒。
  for (let y = 0; y < 500; y += 16) {
    for (let x = 0; x < 1000; x += 16) {
      const seed = (x * 13 + y * 7) % 29
      if (seed < 7) {
        ctx.fillStyle = seed % 3 === 0 ? palette.grassDark : palette.grassLight
        ctx.fillRect(x + 2, y + 3, 3 + (seed % 2), 2)
        if (seed % 4 === 0) ctx.fillRect(x + 9, y + 9, 2, 2)
      }
    }
  }

  // 稀疏的野花与浅色草簇，让空地有自然变化，不干扰建筑轮廓。
  for (let y = 12; y < 490; y += 31) {
    for (let x = 12; x < 990; x += 37) {
      const seed = (x * 19 + y * 23) % 41
      if (seed === 2 || seed === 11) {
        ctx.fillStyle = seed === 2 ? '#e6d99a' : '#d8e0ad'
        ctx.fillRect(x, y, 2, 2)
        ctx.fillStyle = '#7f9d69'
        ctx.fillRect(x + 2, y + 2, 2, 2)
      }
    }
  }
}
function drawBuildings(ctx) {
  const roofSets = [
    { base: '#c17a5d', light: '#e9ad80', dark: '#925844' },
    { base: '#ae765c', light: '#dfaa7d', dark: '#805442' },
    { base: '#bd875c', light: '#edbd86', dark: '#8f5e43' },
    { base: '#a27a61', light: '#d9ad82', dark: '#765846' },
  ]
  CAMPUS_BUILDING_FOOTPRINTS.forEach((building, index) => {
    const [x1, y1, x2, y2] = getCampusFootprintBounds(building) || [0, 0, 0, 0]
    const footprint = building.polygon || [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    if (building.polygon) {
      const w = x2 - x1, h = y2 - y1
      const roof = roofSets[index % roofSets.length]
      const facadeHeight = Math.max(3, Math.min(5, h * .24))
      const roofHeight = h - facadeHeight
      ctx.fillStyle = 'rgba(48,65,48,.22)'
      polygon(ctx, footprint.map(([x, y]) => [x + 3, y + 4]))
      ctx.fill()
      polygon(ctx, footprint)
      ctx.fillStyle = roof.dark
      ctx.fill()
      ctx.save()
      polygon(ctx, footprint)
      ctx.clip()
      ctx.fillStyle = roof.base
      ctx.fillRect(x1, y1, w, roofHeight)
      ctx.fillStyle = roof.light
      for (let stripeY = y1 + 3; stripeY < y1 + roofHeight - 1; stripeY += 4) {
        ctx.fillRect(x1 + 3, stripeY, Math.max(1, w - 6), 1)
      }
      ctx.fillStyle = '#9b684f'
      ctx.fillRect(x1, y1 + roofHeight, w, facadeHeight)
      const windowCount = Math.max(2, Math.floor(w / 13))
      for (let col = 0; col < windowCount; col++) {
        const wx = x1 + 4 + col * ((w - 8) / windowCount)
        ctx.fillStyle = '#536d70'
        ctx.fillRect(wx, y1 + roofHeight + 1, 3, Math.max(1, facadeHeight - 2))
      }
      ctx.restore()
      polygon(ctx, footprint)
      ctx.strokeStyle = roof.dark
      ctx.lineWidth = 1
      ctx.stroke()
      return
    }
    const w = x2 - x1, h = y2 - y1
    const roof = roofSets[index % roofSets.length]
    const variant = index % 4
    const facadeHeight = Math.max(3, Math.min(5, h * .24))
    const roofHeight = h - facadeHeight

    // 轻量投影与建筑主体，统一从左上方受光。
    ctx.fillStyle = 'rgba(48,65,48,.22)'
    ctx.fillRect(x1 + 3, y1 + 4, w + 1, h + 1)
    ctx.fillStyle = roof.dark
    ctx.fillRect(x1 - 1, y1 - 1, w + 2, h + 2)
    ctx.fillStyle = roof.base
    ctx.fillRect(x1, y1, w, roofHeight)
    ctx.fillStyle = roof.light
    ctx.fillRect(x1 + 1, y1 + 1, Math.max(2, w - 2), 1)
    ctx.fillStyle = roof.dark
    ctx.fillRect(x1, y1 + roofHeight - 1, w, 1)

    // 屋顶纹理按楼栋轮换，保持像素语言一致但避免复制粘贴感。
    if (variant === 0) {
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + 5, y1 + 3, Math.max(6, w * .32), 2)
      ctx.fillStyle = roof.dark
      ctx.fillRect(x1 + w - 9, y1 + 3, 4, 3)
      ctx.fillStyle = '#ead0a0'
      ctx.fillRect(x1 + w - 8, y1 + 3, 2, 1)
    } else if (variant === 1) {
      ctx.fillStyle = roof.light
      for (let stripeY = y1 + 3; stripeY < y1 + roofHeight - 1; stripeY += 4) {
        ctx.fillRect(x1 + 3, stripeY, w - 6, 1)
      }
      ctx.fillStyle = roof.dark
      ctx.fillRect(x1 + w * .48, y1 + 3, 2, Math.max(3, roofHeight - 5))
    } else if (variant === 2) {
      ctx.fillStyle = '#6e7770'
      ctx.fillRect(x1 + w * .55, y1 + 3, Math.max(4, w * .2), Math.max(3, roofHeight - 5))
      ctx.fillStyle = '#b9d1c1'
      ctx.fillRect(x1 + w * .55 + 1, y1 + 4, Math.max(2, w * .2 - 2), 1)
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + 4, y1 + roofHeight - 4, w - 8, 1)
    } else {
      ctx.fillStyle = roof.dark
      ctx.fillRect(x1 + w * .3, y1 + 3, w * .4, Math.max(3, roofHeight - 6))
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + w * .3 + 2, y1 + 4, w * .4 - 4, 1)
    }

    // 屋顶檐口、屋脊与角部高光，形成更清晰的像素建筑轮廓。
    if (w >= 14 && roofHeight >= 7) {
      ctx.fillStyle = roof.dark
      ctx.fillRect(x1 + 2, y1 + roofHeight * .52, w - 4, 1)
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + 2, y1 + roofHeight * .52 - 1, w - 4, 1)
      ctx.fillRect(x1 + 2, y1 + 2, 2, 2)
      ctx.fillRect(x1 + w - 4, y1 + 2, 2, 2)
    }
    if (w >= 22 && roofHeight >= 10) {
      // 小型屋顶附属结构：不代表真实设施，仅用于区分建筑剪影。
      ctx.fillStyle = roof.dark
      ctx.fillRect(x1 + w * .68, y1 + 3, 5, 4)
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + w * .68 + 1, y1 + 3, 3, 1)
    }

    // 朝向不明确时只表达统一的下沿立面，不虚构入口方向。
    const facadeY = y1 + roofHeight
    ctx.fillStyle = '#9b684f'
    ctx.fillRect(x1, facadeY, w, facadeHeight)
    ctx.fillStyle = '#e0aa7e'
    ctx.fillRect(x1, facadeY, 2, facadeHeight)
    ctx.fillStyle = '#c58a67'
    ctx.fillRect(x1 + w - 2, facadeY, 2, facadeHeight)
    const windowCount = Math.max(2, Math.floor(w / 13))
    for (let col = 0; col < windowCount; col++) {
      const wx = x1 + 4 + col * ((w - 8) / windowCount)
      ctx.fillStyle = '#536d70'
      ctx.fillRect(wx, facadeY + 1, 3, Math.max(1, facadeHeight - 2))
      ctx.fillStyle = '#d7d7a0'
      ctx.fillRect(wx + 1, facadeY + 1, 1, 1)
    }
    ctx.strokeStyle = roof.dark
    ctx.lineWidth = 1
    ctx.strokeRect(x1 - 1.5, y1 - 1.5, w + 3, h + 3)
  })
}
function drawTrees(ctx) {
  TREE_SPOTS.forEach(([x, y], index) => {
    const variant = index % 3
    ctx.fillStyle = 'rgba(51,77,54,.2)'
    ctx.fillRect(x - 5, y + 3, 11, 4)
    ctx.fillStyle = '#496e4b'
    ctx.fillRect(x - 4, y - 4, 9, 8)
    if (variant === 0) {
      ctx.fillRect(x - 7, y - 2, 4, 5)
      ctx.fillRect(x + 4, y - 1, 4, 5)
      ctx.fillStyle = '#6f9d60'
      ctx.fillRect(x - 5, y - 8, 11, 7)
      ctx.fillStyle = '#a3c982'
      ctx.fillRect(x - 2, y - 8, 4, 2)
      ctx.fillRect(x + 3, y - 5, 2, 2)
    } else if (variant === 1) {
      ctx.fillStyle = '#638d59'
      ctx.fillRect(x - 5, y - 8, 10, 8)
      ctx.fillStyle = '#8eb66d'
      ctx.fillRect(x - 3, y - 10, 7, 5)
      ctx.fillStyle = '#b3cf85'
      ctx.fillRect(x - 2, y - 9, 3, 2)
    } else {
      ctx.fillStyle = '#527c50'
      ctx.fillRect(x - 6, y - 6, 12, 8)
      ctx.fillStyle = '#82aa66'
      ctx.fillRect(x - 3, y - 10, 8, 7)
      ctx.fillStyle = '#b0ca80'
      ctx.fillRect(x - 1, y - 9, 3, 2)
    }
  })
}
const TREE_SPOTS = (() => {
  const spots = []
  for (let y = 80; y < 450; y += 24) {
    for (let x = 175; x < 830; x += 26) {
      if ((x * 17 + y * 29) % 23 > 3) continue
      const nearBuilding = CAMPUS_BUILDING_FOOTPRINTS.some(building => { const [l, t, r, b] = getCampusFootprintBounds(building) || []; return x > l - 9 && x < r + 9 && y > t - 9 && y < b + 9 })
      const nearRoad = CAMPUS_ROAD_CENTERLINES.some(({ points }) => points.some(([px, py]) => Math.hypot(px - x, py - y) < 9))
      const inWater = CAMPUS_AREAS.some(area => area.type === 'water' && area.polygon && pointInCampusPolygon([x, y], area.polygon) && !(area.holes || []).some(hole => pointInCampusPolygon([x, y], hole)))
      if (!nearBuilding && !nearRoad && !inWater) spots.push([x, y])
    }
  }
  return spots
})()

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
  drawAreas(ctx)
  drawRoads(ctx)
  drawTrees(ctx)
  drawBuildings(ctx)
  drawLabels(ctx)
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
  drawExplorerCharacter(ctx, player.value)
  drawForegroundTreeCanopies(ctx, player.value)
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
function drawForegroundTreeCanopies(ctx, actor) {
  // 仅重绘角色后方且与角色发生空间重叠的树冠，形成基础前后遮挡。
  for (let index = 0; index < TREE_SPOTS.length; index++) {
    const [x, y] = TREE_SPOTS[index]
    if (actor.y >= y + 2 || Math.abs(actor.x - x) > 10 || y - actor.y > 18) continue
    const variant = index % 3
    ctx.fillStyle = variant === 1 ? '#638d59' : variant === 2 ? '#527c50' : '#6f9d60'
    ctx.fillRect(x - 5, y - 8, 10, 7)
    if (variant === 0) ctx.fillRect(x - 7, y - 2, 14, 5)
    if (variant === 1) ctx.fillRect(x - 3, y - 10, 7, 5)
    if (variant === 2) ctx.fillRect(x - 3, y - 10, 8, 7)
    ctx.fillStyle = '#a3c982'
    ctx.fillRect(x - 2, y - 8, 4, 2)
  }
}
function canPlayerMoveTo(x, y) {
  if (x < 8 || x > 992 || y < 8 || y > 492) return false
  for (const building of CAMPUS_BUILDING_FOOTPRINTS) {
    const [left, top, right, bottom] = getCampusFootprintBounds(building) || [0, 0, 0, 0]
    const blocked = building.polygon
      ? pointInCampusPolygon([x, y], building.polygon)
      : x >= left - 2 && x <= right + 2 && y >= top - 2 && y <= bottom + 2
    if (blocked) return false
  }
  return !CAMPUS_AREAS.some(area =>
    area.type === 'water' &&
    pointInCampusPolygon([x, y], area.polygon) &&
    !(area.holes || []).some(hole => pointInCampusPolygon([x, y], hole))
  )
}
function onExplorerKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat && !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(event.key)) return
  const key = event.key.toLowerCase()
  const directions = {
    arrowup: [0, -1, 'up'], w: [0, -1, 'up'],
    arrowdown: [0, 1, 'down'], s: [0, 1, 'down'],
    arrowleft: [-1, 0, 'left'], a: [-1, 0, 'left'],
    arrowright: [1, 0, 'right'], d: [1, 0, 'right'],
  }
  const direction = directions[key]
  if (!direction) return
  event.preventDefault()
  const [rawDx, rawDy, facing] = direction
  const length = Math.hypot(rawDx, rawDy) || 1
  const dx = rawDx / length, dy = rawDy / length
  const nextX = player.value.x + dx * PLAYER_SPEED
  const nextY = player.value.y + dy * PLAYER_SPEED
  player.value.direction = facing
  const previousX = player.value.x, previousY = player.value.y
  if (canPlayerMoveTo(nextX, player.value.y)) player.value.x = nextX
  if (canPlayerMoveTo(player.value.x, nextY)) player.value.y = nextY
  player.value.walking = player.value.x !== previousX || player.value.y !== previousY
  if (player.value.walking) player.value.walkFrame++
  followPlayerCamera()
  selected.value = null
  render()
}
function pointerPosition(event) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
function hitTest(screenPoint) {
  const { scale, x, y } = mapToScreen()
  const px = (screenPoint.x - x) / scale, py = (screenPoint.y - y) / scale
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
  resizeObserver = new ResizeObserver(resize)
  if (canvas.value) resizeObserver.observe(canvas.value)
  window.addEventListener('resize', resize)
  window.addEventListener('keydown', onExplorerKeydown)
  resize()
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', resize)
  window.removeEventListener('keydown', onExplorerKeydown)
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
        <div class="pixel-header-tag"><i></i> RPG 校园探索 · WASD / 方向键移动</div>
        <button class="pixel-showcase-link" @click="openShowcase">进入 3D 场景预览 <span>↗</span></button>
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
      <strong>探索模式</strong>
      <span style="opacity:.7;">X {{ Math.round(player.x) }} · Y {{ Math.round(player.y) }}</span>
    </div>
    <div class="pixel-map-controls">
      <button @click="zoomBy(1.2)" aria-label="放大">＋</button>
      <button @click="zoomBy(.84)" aria-label="缩小">－</button>
      <button @click="resetView">复位</button>
    </div>
    <div class="pixel-map-legend"><span><i class="legend-building"></i> 建筑</span><span><i class="legend-water"></i> 湖泊</span><span><i class="legend-road"></i> 道路</span><span><i class="legend-sports"></i> 运动场</span></div>
    <aside v-if="selected" class="pixel-selection">
      <button class="pixel-selection-close" aria-label="关闭" @click="selected = null; render()">×</button>
      <small>校园地点 / CAMPUS PLACE</small>
      <strong>{{ selectedTitle }}</strong>
      <span>{{ selected.type === 'building' ? '建筑轮廓' : selected.type === 'water' ? '湖泊水域' : selected.type === 'sports' ? '运动场地' : '校园区域' }}</span>
      <em>位置数据：{{ selected.confidence === 'low' ? '待核验' : '近似标注' }}</em>
    </aside>
    <footer class="pixel-footer"><span>NCGXY · CAMPUS MAP</span><span>WASD / 方向键移动 · 镜头跟随 · 拖动浏览 / 滚轮缩放</span></footer>
  </section>
</template>
