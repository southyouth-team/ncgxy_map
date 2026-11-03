<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  CAMPUS_AREAS,
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_ROAD_CENTERLINES,
} from '../data/campus/campusLayout.js'

const canvas = ref(null)
const selected = ref(null)
const zoom = ref(1)
const mapOffset = ref({ x: 0, y: 0 })
const viewport = ref({ width: 0, height: 0 })
let resizeObserver
let dragState = null
let dpr = 1
const selectedTitle = computed(() => selected.value?.label || selected.value?.name || '校园')
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
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'bevel'
    ctx.strokeStyle = palette.roadEdge
    ctx.lineWidth = road.id.includes('perimeter') ? 12 : 9
    ctx.beginPath()
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.stroke()
    ctx.strokeStyle = palette.road
    ctx.lineWidth = road.id.includes('perimeter') ? 8 : 5.5
    ctx.stroke()
    ctx.strokeStyle = palette.roadMark
    ctx.lineWidth = 1
    ctx.setLineDash([3, 5])
    ctx.stroke()
    ctx.setLineDash([])
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
  for (let y = 0; y < 500; y += 18) {
    for (let x = 0; x < 1000; x += 18) {
      const seed = (x * 13 + y * 7) % 17
      if (seed < 3) {
        ctx.fillStyle = seed === 0 ? palette.grassDark : palette.grassLight
        ctx.fillRect(x + 2, y + 3, 5, 3)
        ctx.fillRect(x + 9, y + 9, 3, 3)
      }
    }
  }
}
function drawBuildings(ctx) {
  const roofSets = [
    { base: '#b86f58', light: '#e5a47a', dark: '#925844' },
    { base: '#a96f59', light: '#d99a70', dark: '#805442' },
    { base: '#b77d55', light: '#e7b77c', dark: '#8f5e43' },
    { base: '#98745d', light: '#d2a47a', dark: '#765846' },
  ]
  CAMPUS_BUILDING_FOOTPRINTS.forEach((building, index) => {
    const [x1, y1, x2, y2] = building.rect
    const w = x2 - x1, h = y2 - y1
    const roof = roofSets[index % roofSets.length]
    const variant = index % 4
    const wallHeight = Math.max(3, Math.min(5, h * .22))

    // 投影与建筑侧墙：统一光照方向，建立清晰的像素层级。
    ctx.fillStyle = 'rgba(48,65,48,.22)'
    ctx.fillRect(x1 + 3, y1 + 5, w + 1, h + 1)
    ctx.fillStyle = '#9b684f'
    ctx.fillRect(x1, y1 + wallHeight, w, h - wallHeight)
    ctx.fillStyle = '#e0aa7e'
    ctx.fillRect(x1, y1 + wallHeight, 2, h - wallHeight)
    ctx.fillStyle = '#c58a67'
    ctx.fillRect(x1 + w - 2, y1 + wallHeight, 2, h - wallHeight)

    // 屋顶采用不同的檐口和分区细节，避免所有楼栋完全同形。
    ctx.fillStyle = roof.dark
    ctx.fillRect(x1 - 2, y1 - 2, w + 4, h + 5)
    ctx.fillStyle = roof.base
    ctx.fillRect(x1 - 1, y1 - 3, w + 2, h + 2)
    ctx.fillStyle = roof.light
    ctx.fillRect(x1, y1 - 2, w, 2)
    ctx.fillStyle = roof.dark
    ctx.fillRect(x1, y1 + 1, w, 1)

    if (variant === 0) {
      // 平屋顶：分区屋面与设备小方块。
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + 5, y1 + 4, Math.max(6, w * .32), 2)
      ctx.fillStyle = roof.dark
      ctx.fillRect(x1 + w - 9, y1 + 4, 4, 3)
      ctx.fillStyle = '#ead0a0'
      ctx.fillRect(x1 + w - 8, y1 + 4, 2, 1)
    } else if (variant === 1) {
      // 双坡屋面视觉：中央屋脊与两侧瓦片分区。
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + 3, y1 + 3, w - 6, 2)
      ctx.fillStyle = roof.dark
      ctx.fillRect(x1 + 3, y1 + 6, w - 6, 1)
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + 3, y1 + 9, w - 6, 1)
    } else if (variant === 2) {
      // 屋顶天窗与分段檐口。
      ctx.fillStyle = '#6e7770'
      ctx.fillRect(x1 + w * .55, y1 + 4, Math.max(4, w * .2), 3)
      ctx.fillStyle = '#b9d1c1'
      ctx.fillRect(x1 + w * .55 + 1, y1 + 5, Math.max(2, w * .2 - 2), 1)
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + 4, y1 + h - 5, w - 8, 2)
    } else {
      // 中央屋顶平台。
      ctx.fillStyle = roof.dark
      ctx.fillRect(x1 + w * .3, y1 + 3, w * .4, h - 7)
      ctx.fillStyle = roof.light
      ctx.fillRect(x1 + w * .3 + 2, y1 + 4, w * .4 - 4, 2)
    }

    // 立面窗户：保持小尺寸和统一间距，不堆叠高成本装饰。
    const cols = Math.max(2, Math.floor(w / 10))
    const rows = Math.max(1, Math.floor((h - wallHeight) / 8))
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const wx = x1 + 4 + col * ((w - 8) / cols)
        const wy = y1 + wallHeight + 2 + row * ((h - wallHeight - 4) / rows)
        ctx.fillStyle = '#536d70'
        ctx.fillRect(wx, wy, 3, Math.min(4, Math.max(2, (h - wallHeight) / (rows + 2))))
        ctx.fillStyle = '#d7d7a0'
        ctx.fillRect(wx + 1, wy, 1, 1)
        ctx.fillStyle = 'rgba(255,239,185,.35)'
        ctx.fillRect(wx, wy + 1, 1, 1)
      }
    }
    ctx.fillStyle = '#f0d2a0'
    ctx.fillRect(x1 + w * .46, y1 + wallHeight + 1, Math.max(3, w * .08), Math.max(2, h - wallHeight - 2))
    ctx.strokeStyle = roof.dark
    ctx.lineWidth = 1
    ctx.strokeRect(x1 - 1.5, y1 - 2.5, w + 3, h + 3)
  })
}
function drawTrees(ctx) {
  for (const [x, y] of TREE_SPOTS) {
    ctx.fillStyle = 'rgba(51,77,54,.2)'
    ctx.fillRect(x - 4, y + 2, 10, 5)
    ctx.fillStyle = '#557b52'
    ctx.fillRect(x - 4, y - 6, 9, 8)
    ctx.fillStyle = '#79a96b'
    ctx.fillRect(x - 2, y - 9, 7, 6)
    ctx.fillStyle = '#9bc47d'
    ctx.fillRect(x - 1, y - 8, 3, 2)
  }
}
function pointInPolygon(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    const intersect = ((yi > point[1]) !== (yj > point[1])) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const TREE_SPOTS = (() => {
  const spots = []
  for (let y = 80; y < 450; y += 24) {
    for (let x = 175; x < 830; x += 26) {
      if ((x * 17 + y * 29) % 23 > 3) continue
      const nearBuilding = CAMPUS_BUILDING_FOOTPRINTS.some(({ rect: [l, t, r, b] }) => x > l - 9 && x < r + 9 && y > t - 9 && y < b + 9)
      const nearRoad = CAMPUS_ROAD_CENTERLINES.some(({ points }) => points.some(([px, py]) => Math.hypot(px - x, py - y) < 9))
      const inWater = CAMPUS_AREAS.some(area => area.type === 'water' && area.polygon && pointInPolygon([x, y], area.polygon) && !(area.holes || []).some(hole => pointInPolygon([x, y], hole)))
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
function render() {
  const el = canvas.value
  if (!el || !viewport.value.width || !viewport.value.height) return
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
  drawGround(ctx)
  drawRoads(ctx)
  drawAreas(ctx)
  drawTrees(ctx)
  drawBuildings(ctx)
  drawLabels(ctx)
  if (selected.value?.type === 'building') {
    const item = CAMPUS_BUILDING_FOOTPRINTS.find(b => b.id === selected.value.id)
    if (item) {
      const [l, t, r, b] = item.rect
      ctx.strokeStyle = '#fff2a8'
      ctx.lineWidth = 2 / scale
      ctx.strokeRect(l - 4, t - 5, r - l + 8, b - t + 9)
    }
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
function pointerPosition(event) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
function hitTest(screenPoint) {
  const { scale, x, y } = mapToScreen()
  const px = (screenPoint.x - x) / scale, py = (screenPoint.y - y) / scale
  for (const building of CAMPUS_BUILDING_FOOTPRINTS) {
    const [l, t, r, b] = building.rect
    if (px >= l - 3 && px <= r + 3 && py >= t - 4 && py <= b + 3) return { type: 'building', id: building.id, label: building.label, confidence: building.confidence }
  }
  for (const area of CAMPUS_AREAS) {
    if (area.rect) {
      const [l, t, r, b] = area.rect
      if (px >= l && px <= r && py >= t && py <= b) return { type: area.type, id: area.id, name: area.name, confidence: area.confidence }
    }
    if (area.polygon && pointInPolygon([px, py], area.polygon)) return { type: area.type, id: area.id, name: area.name, confidence: area.confidence }
  }
  return null
}
function onPointerDown(event) {
  if (event.button !== 0) return
  canvas.value.setPointerCapture(event.pointerId)
  dragState = { ...pointerPosition(event), origin: { ...mapOffset.value }, moved: false }
}
function onPointerMove(event) {
  if (!dragState) return
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
    render()
  }
  dragState = null
}
function onWheel(event) {
  event.preventDefault()
  zoom.value = Math.max(.72, Math.min(2.8, zoom.value * (event.deltaY < 0 ? 1.12 : .89)))
  render()
}
function resetView() { zoom.value = 1; mapOffset.value = { x: 0, y: 0 }; render() }
function zoomBy(value) { zoom.value = Math.max(.72, Math.min(2.8, zoom.value * value)); render() }
onMounted(() => {
  resizeObserver = new ResizeObserver(resize)
  if (canvas.value) resizeObserver.observe(canvas.value)
  window.addEventListener('resize', resize)
  resize()
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', resize)
})
</script>

<template>
  <section class="pixel-campus">
    <header class="pixel-header">
      <div class="pixel-brand">
        <div class="pixel-emblem">NC</div>
        <div><strong>南昌工学院</strong><span>NANCHANG INSTITUTE OF TECHNOLOGY</span></div>
      </div>
      <div class="pixel-header-tag"><i></i> 像素校园地图</div>
    </header>
    <canvas
      ref="canvas"
      class="pixel-map-canvas"
      aria-label="南昌工学院二维像素校园地图，可拖动平移、滚轮缩放、点击建筑查看信息"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
      @contextmenu.prevent
    />
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
    <footer class="pixel-footer"><span>NCGXY · CAMPUS MAP</span><span>平面像素地图 · 拖动浏览 / 滚轮缩放 / 点击查看</span></footer>
  </section>
</template>
