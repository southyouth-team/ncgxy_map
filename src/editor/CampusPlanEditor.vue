<script setup>
import { computed, ref } from 'vue'
import { rectToPolygon, movePolygon, rotatePolygon, polygonBounds, normalizeBuilding, roadToPolygon } from './campusEditorDocument.js'
import {
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_ROAD_CENTERLINES,
  CAMPUS_AREAS,
} from '../data/campus/campusLayout.js'

const emit = defineEmits(['close', 'preview'])
const buildings = ref(CAMPUS_BUILDING_FOOTPRINTS.map((item) => normalizeBuilding(item)))
const areas = ref(CAMPUS_AREAS.map((item) => ({
  ...item,
  footprint: item.polygon?.map((point) => [...point]) || rectToPolygon(item.rect),
})))
const roads = ref(CAMPUS_ROAD_CENTERLINES.map((item) => ({ ...item, points: item.points.map((point) => [...point]) })))
const selected = ref({ type: 'building', id: buildings.value[0]?.id })
const tool = ref('select')
const scale = ref(1)
const showGrid = ref(false)
const drag = ref(null)
const history = ref([])
const future = ref([])
const roadWidth = ref(10)
const snapEnabled = ref(true)
const snapTolerance = 7
const newBuilding = ref('教学楼')
const selectedBuilding = computed(() => buildings.value.find((item) => item.id === selected.value.id))
const selectedRoad = computed(() => roads.value.find((item) => item.id === selected.value.id))
const selectedArea = computed(() => areas.value.find((item) => item.id === selected.value.id))
const selectedLabel = computed(() => selectedBuilding.value?.label || selectedRoad.value?.id || selectedArea.value?.name || '未选择对象')
const palette = ['教学楼','宿舍楼','办公楼','实验楼','图书馆','体育馆']
const areaColor = (type) => type === 'water' ? '#6bb8b4' : type === 'sports' ? '#b9b69f' : '#78936d'
const roadPath = (points) => {
  if (points.length < 3) return 'M ' + points.map((p) => p.join(' ')).join(' L ')
  let path = 'M ' + points[0][0] + ' ' + points[0][1]
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1], current = points[i]
    const midpoint = [(previous[0] + current[0]) / 2, (previous[1] + current[1]) / 2]
    path += ' Q ' + previous[0] + ' ' + previous[1] + ' ' + midpoint[0] + ' ' + midpoint[1]
  }
  const last = points[points.length - 1]
  return path + ' L ' + last[0] + ' ' + last[1]
}
function snapshot() {
  history.value.push(JSON.stringify({ buildings: buildings.value, roads: roads.value, areas: areas.value }))
  if (history.value.length > 40) history.value.shift()
  future.value = []
}
function restore(raw) {
  const state = JSON.parse(raw)
  buildings.value = state.buildings
  roads.value = state.roads
  areas.value = state.areas || areas.value
}
function undo() {
  if (!history.value.length) return
  future.value.push(JSON.stringify({ buildings: buildings.value, roads: roads.value, areas: areas.value }))
  restore(history.value.pop())
}
function redo() {
  if (!future.value.length) return
  history.value.push(JSON.stringify({ buildings: buildings.value, roads: roads.value, areas: areas.value }))
  restore(future.value.pop())
}
function point(event) {
  const svg = event.currentTarget.ownerSVGElement || event.currentTarget
  const p = svg.createSVGPoint()
  p.x = event.clientX; p.y = event.clientY
  const local = p.matrixTransform(svg.getScreenCTM().inverse())
  return { x: local.x, y: local.y }
}
function startBuildingDrag(event, item) {
  if (tool.value !== 'select') return
  event.stopPropagation()
  selected.value = { type: 'building', id: item.id }
  snapshot()
  const p = point(event)
  drag.value = { type: 'building', id: item.id, start: p, footprint: item.footprint.map((point) => [...point]) }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
function startAreaDrag(event, area) {
  if (tool.value !== 'select') return
  event.stopPropagation()
  selected.value = { type: 'area', id: area.id }
  snapshot()
  const p = point(event)
  drag.value = { type: 'area', id: area.id, start: p, footprint: area.footprint.map((vertex) => [...vertex]) }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
function startPolygonVertexDrag(event, type, item, index) {
  event.stopPropagation()
  selected.value = { type, id: item.id }
  snapshot()
  drag.value = { type: 'vertex', featureType: type, id: item.id, index }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
function startRoadNodeDrag(event, road, index) {
  event.stopPropagation()
  selected.value = { type: 'road', id: road.id }
  snapshot()
  drag.value = { type: 'node', id: road.id, index }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
function movePointer(event) {
  if (!drag.value) return
  const p = point(event)
  if (drag.value.type === 'vertex') {
    const collection = drag.value.featureType === 'building' ? buildings.value : areas.value
    const item = collection.find((entry) => entry.id === drag.value.id)
    if (item) {
      const candidate = snapEnabled.value ? snapPoint(p, drag.value.index) : p
      item.footprint[drag.value.index] = [candidate.x, candidate.y]
      if (drag.value.featureType === 'building') item.rect = polygonBounds(item.footprint)
    }
  } else if (drag.value.type === 'building') {
    const item = buildings.value.find((entry) => entry.id === drag.value.id)
    const dx = p.x - drag.value.start.x, dy = p.y - drag.value.start.y
    item.footprint = movePolygon(drag.value.footprint, dx, dy)
    item.rect = polygonBounds(item.footprint)
  } else if (drag.value.type === 'area') {
    const area = areas.value.find((entry) => entry.id === drag.value.id)
    if (area) area.footprint = movePolygon(drag.value.footprint, p.x - drag.value.start.x, p.y - drag.value.start.y)
  } else {
    const road = roads.value.find((entry) => entry.id === drag.value.id)
    if (road) road.points[drag.value.index] = [p.x, p.y]
  }
}
function snapPoint(position, excludedIndex = -1) {
  const candidates = []
  for (const building of buildings.value) building.footprint.forEach((vertex, index) => { if (building.id !== selected.value.id || index !== excludedIndex) candidates.push(vertex) })
  for (const area of areas.value) area.footprint.forEach((vertex, index) => { if (area.id !== selected.value.id || index !== excludedIndex) candidates.push(vertex) })
  for (const road of roads.value) road.points.forEach((vertex) => candidates.push(vertex))
  let nearest = null, distance = snapTolerance
  for (const vertex of candidates) { const next = Math.hypot(position.x - vertex[0], position.y - vertex[1]); if (next < distance) { distance = next; nearest = { x: vertex[0], y: vertex[1] } } }
  return nearest || position
}
function addPolygonVertex() {
  const item = selectedBuilding.value || selectedArea.value
  if (!item) return
  snapshot()
  const ring = item.footprint
  let bestIndex = 0, bestLength = -Infinity
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const length = Math.hypot(b[0]-a[0], b[1]-a[1]); if (length > bestLength) { bestLength = length; bestIndex = i } }
  const a = ring[bestIndex], b = ring[(bestIndex + 1) % ring.length]
  ring.splice(bestIndex + 1, 0, [(a[0]+b[0])/2, (a[1]+b[1])/2])
  if (selectedBuilding.value) item.rect = polygonBounds(ring)
}
function removePolygonVertex(index) {
  const item = selectedBuilding.value || selectedArea.value
  if (!item || item.footprint.length <= 3) return
  snapshot()
  item.footprint.splice(index, 1)
  if (selectedBuilding.value) item.rect = polygonBounds(item.footprint)
}
function endPointer() { drag.value = null }
function addBuilding(event) {
  snapshot()
  const position = event?.clientX != null ? point(event) : { x: 305, y: 232 }
  const id = `placed-building-${Date.now()}`
  const rect = [position.x - 25, position.y - 12, position.x + 25, position.y + 12]
  buildings.value.push({ id, label: newBuilding.value, rect, footprint: rectToPolygon(rect), floors: null, confidence: 'unverified' })
  selected.value = { type: 'building', id }
  tool.value = 'select'
}
function addRoad(event) {
  snapshot()
  const position = event?.clientX != null ? point(event) : { x: 300, y: 265 }
  const id = `road-custom-${Date.now()}`
  roads.value.push({ id, confidence: 'unverified', points: [[position.x - 45, position.y],[position.x, position.y + 8],[position.x + 45, position.y]], width: roadWidth.value })
  selected.value = { type: 'road', id }
  tool.value = 'select'
}
function rotateBuilding() {
  const item = selectedBuilding.value
  if (!item) return
  snapshot()
  item.footprint = rotatePolygon(item.footprint, 90)
  item.rect = polygonBounds(item.footprint)
}
function addRoadNode() {
  const road = selectedRoad.value
  if (!road || road.points.length < 2) return
  snapshot()
  let index = 0, longest = -Infinity
  for (let i = 0; i < road.points.length - 1; i++) { const a = road.points[i], b = road.points[i+1]; const length = Math.hypot(b[0]-a[0], b[1]-a[1]); if (length > longest) { longest = length; index = i } }
  const a = road.points[index], b = road.points[index+1]
  road.points.splice(index+1, 0, [(a[0]+b[0])/2, (a[1]+b[1])/2])
}
function removeRoadNode(index) {
  const road = selectedRoad.value
  if (!road || road.points.length <= 2) return
  snapshot()
  road.points.splice(index, 1)
}
function deleteSelected() {
  snapshot()
  if (selected.value.type === 'building') buildings.value = buildings.value.filter(item => item.id !== selected.value.id)
  if (selected.value.type === 'road') roads.value = roads.value.filter(item => item.id !== selected.value.id)
  if (selected.value.type === 'area') areas.value = areas.value.filter(item => item.id !== selected.value.id)
  selected.value = { type: '', id: '' }
}
function buildDocument() {
  return { schemaVersion: 2, coordinateSystem: 'campus-plan-pixel', units: 'pixel', source: 'campusLayout.js', areas: areas.value.map(({ polygon, rect, ...area }) => ({ ...area, polygon: area.footprint })), buildings: buildings.value, roads: roads.value, objects: [] }
}
function preview3d() { emit('preview', buildDocument()) }
function exportDocument() {
  const payload = buildDocument()
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'ncgxy-campus-layout.json'; anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="campus-editor">
    <header class="editor-header">
      <div class="brand"><span class="brand-mark">NC</span><div><strong>南昌工学院 · 场景编辑器</strong><small>CAMPUS PLAN EDITOR / TOP-DOWN WORKSPACE</small></div></div>
      <div class="header-actions">
        <button @click="undo" :disabled="!history.length">撤销</button><button @click="redo" :disabled="!future.length">重做</button>
        <button @click="showGrid = !showGrid">{{ showGrid ? '隐藏网格' : '显示网格' }}</button><button :class="{primary:snapEnabled}" @click="snapEnabled=!snapEnabled">顶点吸附 {{ snapEnabled ? '开' : '关' }}</button>
        <button @click="scale = Math.max(.65, scale - .1)">−</button><span class="zoom-value">{{ Math.round(scale*100) }}%</span><button @click="scale = Math.min(1.8, scale + .1)">＋</button>
        <button @click="preview3d">三维预览</button><button class="primary" @click="exportDocument">导出场景</button><button @click="emit('close')">退出编辑</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="tool-panel">
        <div class="panel-title">场景工具</div>
        <button :class="{active:tool==='select'}" @click="tool='select'"><span>↖</span>选择 / 移动</button>
        <button :class="{active:tool==='building'}" @click="tool='building'"><span>▰</span>建筑摆放</button>
        <button :class="{active:tool==='road'}" @click="tool='road'"><span>⌁</span>道路编辑</button>
        <div class="panel-separator"></div>
        <div class="panel-title">建筑资源库</div>
        <select v-model="newBuilding"><option v-for="item in palette" :key="item">{{ item }}</option></select>
        <button class="add-button" @click="addBuilding">＋ 放置建筑</button>
        <div class="panel-title road-title">道路工具</div>
        <label>道路宽度 <b>{{ roadWidth }} px</b></label><input v-model.number="roadWidth" type="range" min="4" max="24">
        <button class="add-button" @click="addRoad">＋ 新建道路</button>
        <p class="hint">拖动建筑调整位置；选择道路后拖动控制点调整走向。当前底图来自已有校园空间标注，非测绘数据。</p>
      </aside>
      <main class="map-stage">
        <div class="stage-label"><span class="live-dot"></span> CAMPUS / TOP-DOWN VIEW <em>示意坐标 · 非米制</em></div>
        <div class="map-scroll">
          <svg class="campus-map" :style="{ transform: `scale(${scale})` }" viewBox="0 0 640 480" @pointermove="movePointer" @pointerup="endPointer" @pointercancel="endPointer" @click="tool==='building' ? addBuilding($event) : tool==='road' ? addRoad($event) : null">
            <defs>
              <pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#4c654d" stroke-opacity=".14" stroke-width=".7"/></pattern>
              <pattern id="grass-pattern" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="4" cy="5" r="1" fill="#66865b" opacity=".3"/><circle cx="18" cy="17" r="1" fill="#66865b" opacity=".3"/></pattern>
            </defs>
            <rect width="640" height="480" fill="#91a77b"/><rect x="36" y="92" width="576" height="368" fill="#9db28a"/><rect x="36" y="92" width="576" height="368" fill="url(#grass-pattern)"/>
            <g v-for="area in areas" :key="area.id" @pointerdown="startAreaDrag($event, area)" @click.stop="selected={type:'area',id:area.id}">
              <polygon :points="area.footprint.map(p=>p.join(',')).join(' ')" :fill="areaColor(area.type)" :stroke="selected.id===area.id ? '#e6a84c' : '#d7e5d3'" :stroke-width="selected.id===area.id ? 4 : 2" opacity=".72"/>
              <g v-if="selected.type==='area' && selected.id===area.id"><circle v-for="(vertex,index) in area.footprint" :key="index" :cx="vertex[0]" :cy="vertex[1]" r="5" fill="#f5c36b" stroke="#3d513f" stroke-width="1.5" @pointerdown="startPolygonVertexDrag($event,'area',area,index)" @dblclick.stop="removePolygonVertex(index)"/></g>
            </g>
            <g v-if="showGrid"><rect x="36" y="92" width="576" height="368" fill="url(#map-grid)"/></g>
            <g v-for="road in roads" :key="road.id">
              <polygon :points="roadToPolygon(road.points, (road.width || 13) + 5).map(p=>p.join(',')).join(' ')" fill="#e0d8bd" stroke="#c9c1a9" stroke-width="1" stroke-linejoin="round"/>
              <polygon :points="roadToPolygon(road.points, road.width || 13).map(p=>p.join(',')).join(' ')" :fill="selected.id===road.id ? '#d59a43' : '#777b73'" stroke="#5f635d" stroke-width="1" stroke-linejoin="round" @click.stop="selected={type:'road',id:road.id}"/>
              <g v-if="selected.id===road.id"><circle v-for="(node,index) in road.points" :key="index" :cx="node[0]" :cy="node[1]" r="5" fill="#f0bc61" stroke="#3c4a3d" stroke-width="2" @pointerdown="startRoadNodeDrag($event,road,index)" @dblclick.stop="removeRoadNode(index)"/></g>
            </g>
            <g v-for="item in buildings" :key="item.id" class="building" @pointerdown="startBuildingDrag($event,item)" @click.stop="selected={type:'building',id:item.id}">
              <polygon :points="item.footprint.map(p=>p.join(',')).join(' ')" fill="#bca27c" stroke="#665744" stroke-width="2"/>
              <polygon :points="item.footprint.map(p=>p.join(',')).join(' ')" fill="#d6c19b" stroke="#8f7859" stroke-width="1"/>
              <polygon :points="item.footprint.map(p=>p.join(',')).join(' ')" fill="none" stroke="#f0e5ce" stroke-width="2" stroke-dasharray="4 3"/>
              <text :x="(item.rect[0]+item.rect[2])/2" :y="(item.rect[1]+item.rect[3])/2+3" text-anchor="middle" font-size="8" fill="#514634">{{ item.label }}</text>
              <polygon v-if="selected.id===item.id" :points="item.footprint.map(p=>p.join(',')).join(' ')" fill="none" stroke="#e6a84c" stroke-width="2" stroke-dasharray="5 3"/>
              <g v-if="selected.type==='building' && selected.id===item.id"><circle v-for="(vertex,index) in item.footprint" :key="index" :cx="vertex[0]" :cy="vertex[1]" r="5" fill="#f5c36b" stroke="#3d513f" stroke-width="1.5" @pointerdown="startPolygonVertexDrag($event,'building',item,index)" @dblclick.stop="removePolygonVertex(index)"/></g>
            </g>
            <g fill="#3f724c" stroke="#d8dfc6" stroke-width="1.5"><g v-for="(tree,index) in [[202,215],[305,210],[355,280],[190,360],[520,275],[565,355],[225,420],[330,430],[485,435],[75,220],[85,260],[570,180]]" :key="index"><circle :cx="tree[0]" :cy="tree[1]" r="7"/><circle :cx="tree[0]-4" :cy="tree[1]+2" r="4"/></g></g>
            <g fill="#435844" font-size="10" font-weight="700"><text x="260" y="178">中心湖区</text><text x="548" y="105">运动场</text><text x="75" y="386">运动场</text></g>
          </svg>
        </div>
        <footer class="stage-footer"><span>画布：校园平面示意图 640 × 480</span><span>对象 {{ buildings.length }} 栋建筑 · {{ roads.length }} 条道路 · {{ areas.length }} 个区域</span><span>坐标来源：校园原图标注</span></footer>
      </main>
      <aside class="inspector">
        <div class="panel-title">属性检查器</div>
        <div class="selected-card"><small>当前选中</small><strong>{{ selectedLabel }}</strong><span>{{ selected.type==='road' ? '道路 / LineString' : selected.type==='building' ? '建筑 / Footprint' : '请选择场景对象' }}</span></div>
        <template v-if="selectedBuilding">
          <label>建筑名称</label><input v-model="selectedBuilding.label">
          <label>空间范围（像素坐标）</label><div class="coordinate-grid"><span>X₁ {{ Math.round(selectedBuilding.rect[0]) }}</span><span>Y₁ {{ Math.round(selectedBuilding.rect[1]) }}</span><span>X₂ {{ Math.round(selectedBuilding.rect[2]) }}</span><span>Y₂ {{ Math.round(selectedBuilding.rect[3]) }}</span></div>
          <label>数据可信度</label><span class="confidence">{{ selectedBuilding.confidence || 'unverified' }}</span>
          <button class="add-button" @click="addPolygonVertex">＋ 添加最长边顶点</button><p class="hint">拖动黄色顶点编辑轮廓；点击顶点删除（至少保留 3 个）。</p><button class="add-button" @click="rotateBuilding">↻ 旋转 90°</button><button class="danger-button" @click="deleteSelected">删除建筑</button>
        </template>
        <template v-else-if="selectedArea">
          <label>区域名称</label><input v-model="selectedArea.name">
          <label>区域类型</label><span class="confidence">{{ selectedArea.type }}</span>
          <button class="add-button" @click="addPolygonVertex">＋ 添加最长边顶点</button><p class="hint">拖动黄色顶点编辑轮廓；点击顶点删除（至少保留 3 个）。支持顶点吸附。</p>
          <button class="danger-button" @click="snapshot(); areas = areas.filter(item => item.id !== selectedArea.id); selected = {type:'',id:''}">删除区域</button>
        </template>
        <template v-else-if="selectedRoad">
          <label>道路宽度</label><input v-model.number="selectedRoad.width" type="range" min="4" max="24">
          <button class="add-button" @click="addRoadNode">＋ 添加道路控制点</button><p class="hint">拖动控制点调整曲线；点击控制点删除（至少保留 2 个）。道路采用平滑曲线显示。</p><button class="danger-button" @click="deleteSelected">删除道路</button>
        </template>
        <div v-else class="empty-inspector">在校园平面图中选择一栋建筑或一条道路。</div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.campus-editor{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;background:#e9e8dc;color:#283b30;font-family:Inter,"Microsoft YaHei",sans-serif}.editor-header{height:64px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 22px;background:#f8f7ef;border-bottom:1px solid #c9cbbb}.brand,.header-actions{display:flex;align-items:center;gap:12px}.brand-mark{display:grid;place-items:center;width:36px;height:36px;background:#315b43;color:#f4e8c9;font-weight:800}.brand strong,.brand small{display:block}.brand strong{font-size:14px}.brand small{font-size:9px;letter-spacing:1.4px;color:#788477;margin-top:4px}.header-actions button,.tool-panel button,.inspector button{border:1px solid #c9cbbb;background:#fffdf5;color:#344b3b;border-radius:3px;padding:8px 11px;font-size:12px;cursor:pointer}.header-actions button:disabled{opacity:.4}.header-actions .primary,.add-button{background:#315b43!important;color:#fff!important;border-color:#315b43!important}.zoom-value{font-size:11px;min-width:36px;text-align:center}.workspace{display:grid;grid-template-columns:190px minmax(0,1fr) 220px;min-height:0;flex:1}.tool-panel,.inspector{background:#f7f6ed;padding:17px 14px;border-right:1px solid #d1d2c5;overflow:auto}.inspector{border-right:0;border-left:1px solid #d1d2c5}.panel-title{font-size:11px;font-weight:800;letter-spacing:1px;color:#607363;margin:2px 0 13px}.tool-panel>button{width:100%;text-align:left;margin-bottom:7px}.tool-panel>button span{display:inline-block;width:23px;font-size:17px}.tool-panel>button.active{background:#e4eadc;border-color:#66866b}.panel-separator{height:1px;background:#d8d9cc;margin:17px 0}.tool-panel select,.inspector input:not([type=range]){width:100%;box-sizing:border-box;border:1px solid #c9cbbb;padding:8px;background:white;margin:7px 0 10px;color:#344b3b}.tool-panel label,.inspector label{display:block;font-size:11px;color:#69766a;margin:14px 0 5px}.tool-panel label b{float:right}.tool-panel input[type=range],.inspector input[type=range]{width:100%;accent-color:#527b58}.road-title{margin-top:22px}.hint{font-size:10px;line-height:1.7;color:#7b867a;margin-top:20px}.map-stage{display:flex;flex-direction:column;min-width:0;background:#d8ddcf}.stage-label{height:38px;display:flex;align-items:center;gap:8px;padding:0 16px;font-size:10px;font-weight:800;letter-spacing:1.1px;color:#4f6653}.stage-label em{font-style:normal;font-weight:400;letter-spacing:0;color:#899184}.live-dot{width:7px;height:7px;border-radius:50%;background:#72965c}.map-scroll{flex:1;min-height:0;overflow:auto;display:grid;place-items:center;padding:18px}.campus-map{width:min(100%,1050px);height:auto;max-height:100%;background:#91a77b;box-shadow:0 12px 35px #384a3528;transform-origin:center;touch-action:none}.building{cursor:move}.building:hover rect:first-child{stroke:#d69c43}.stage-footer{height:32px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:9px;color:#738071;background:#e8e9df}.selected-card{padding:12px;background:#e9eddf;border:1px solid #d1d9c8;margin-bottom:16px}.selected-card small,.selected-card strong,.selected-card span{display:block}.selected-card small{font-size:9px;color:#87917e}.selected-card strong{font-size:13px;margin:6px 0}.selected-card span{font-size:10px;color:#6e7d6e}.coordinate-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.coordinate-grid span{padding:7px;background:#eceee5;font-size:10px}.confidence{font-size:10px;color:#9a7542}.inspector .add-button,.inspector .danger-button{width:100%;margin-top:14px}.danger-button{border-color:#d8b7a9!important;color:#9b4d37!important;background:#fff8f4!important}.empty-inspector{font-size:11px;line-height:1.8;color:#879184;padding:20px 0}@media(max-width:900px){.workspace{grid-template-columns:150px minmax(0,1fr)}.inspector{display:none}.editor-header{padding:0 10px}.header-actions{gap:4px}.header-actions button{padding:7px}.brand small{display:none}}@media(max-width:600px){.workspace{grid-template-columns:112px minmax(0,1fr)}.tool-panel{padding:10px 7px}.tool-panel>button{font-size:10px;padding:7px 5px}.stage-footer span:last-child{display:none}.header-actions button:nth-child(3){display:none}}
</style>
