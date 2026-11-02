<script setup>
import { computed, ref } from 'vue'
import {
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_ROAD_CENTERLINES,
  CAMPUS_AREAS,
} from '../data/campus/campusLayout.js'

const emit = defineEmits(['close', 'preview'])
const buildings = ref(CAMPUS_BUILDING_FOOTPRINTS.map((item) => ({ ...item, rect: [...item.rect] })))
const roads = ref(CAMPUS_ROAD_CENTERLINES.map((item) => ({ ...item, points: item.points.map((point) => [...point]) })))
const selected = ref({ type: 'building', id: buildings.value[0]?.id })
const tool = ref('select')
const scale = ref(1)
const showGrid = ref(false)
const drag = ref(null)
const history = ref([])
const future = ref([])
const roadWidth = ref(10)
const newBuilding = ref('教学楼')
const selectedBuilding = computed(() => buildings.value.find((item) => item.id === selected.value.id))
const selectedRoad = computed(() => roads.value.find((item) => item.id === selected.value.id))
const selectedLabel = computed(() => selectedBuilding.value?.label || selectedRoad.value?.id || '未选择对象')
const palette = ['教学楼','宿舍楼','办公楼','实验楼','图书馆','体育馆']
const areaColor = (type) => type === 'water' ? '#6bb8b4' : type === 'sports' ? '#b9b69f' : '#78936d'
function snapshot() {
  history.value.push(JSON.stringify({ buildings: buildings.value, roads: roads.value }))
  if (history.value.length > 40) history.value.shift()
  future.value = []
}
function restore(raw) {
  const state = JSON.parse(raw)
  buildings.value = state.buildings
  roads.value = state.roads
}
function undo() {
  if (!history.value.length) return
  future.value.push(JSON.stringify({ buildings: buildings.value, roads: roads.value }))
  restore(history.value.pop())
}
function redo() {
  if (!future.value.length) return
  history.value.push(JSON.stringify({ buildings: buildings.value, roads: roads.value }))
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
  drag.value = { type: 'building', id: item.id, start: p, rect: [...item.rect] }
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
  if (drag.value.type === 'building') {
    const item = buildings.value.find((entry) => entry.id === drag.value.id)
    const dx = p.x - drag.value.start.x, dy = p.y - drag.value.start.y
    item.rect = drag.value.rect.map((value, index) => value + (index % 2 === 0 ? dx : dy))
  } else {
    const road = roads.value.find((entry) => entry.id === drag.value.id)
    if (road) road.points[drag.value.index] = [p.x, p.y]
  }
}
function endPointer() { drag.value = null }
function addBuilding() {
  snapshot()
  const id = `placed-building-${Date.now()}`
  buildings.value.push({ id, label: newBuilding.value, rect: [280, 220, 330, 245], floors: null, confidence: 'unverified' })
  selected.value = { type: 'building', id }
  tool.value = 'select'
}
function addRoad() {
  snapshot()
  const id = `road-custom-${Date.now()}`
  roads.value.push({ id, confidence: 'unverified', points: [[250,260],[300,270],[350,260]], width: roadWidth.value })
  selected.value = { type: 'road', id }
  tool.value = 'select'
}
function rotateBuilding() {
  const item = selectedBuilding.value
  if (!item) return
  snapshot()
  const [l,t,r,b] = item.rect
  const cx=(l+r)/2, cy=(t+b)/2, w=b-t, h=r-l
  item.rect=[cx-w/2,cy-h/2,cx+w/2,cy+h/2]
}
function deleteSelected() {
  snapshot()
  if (selected.value.type === 'building') buildings.value = buildings.value.filter(item => item.id !== selected.value.id)
  if (selected.value.type === 'road') roads.value = roads.value.filter(item => item.id !== selected.value.id)
  selected.value = { type: '', id: '' }
}
function exportDocument() {
  const payload = { schemaVersion: 1, coordinateSystem: 'campus-plan-pixel', source: 'campusLayout.js', buildings: buildings.value, roads: roads.value }
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
        <button @click="showGrid = !showGrid">{{ showGrid ? '隐藏网格' : '显示网格' }}</button>
        <button @click="scale = Math.max(.65, scale - .1)">−</button><span class="zoom-value">{{ Math.round(scale*100) }}%</span><button @click="scale = Math.min(1.8, scale + .1)">＋</button>
        <button class="primary" @click="exportDocument">导出场景</button><button @click="emit('close')">退出编辑</button>
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
          <svg class="campus-map" :style="{ transform: `scale(${scale})` }" viewBox="0 0 640 480" @pointermove="movePointer" @pointerup="endPointer" @pointercancel="endPointer" @click="tool==='building' ? addBuilding() : tool==='road' ? addRoad() : null">
            <defs>
              <pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#4c654d" stroke-opacity=".14" stroke-width=".7"/></pattern>
              <pattern id="grass-pattern" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="4" cy="5" r="1" fill="#66865b" opacity=".3"/><circle cx="18" cy="17" r="1" fill="#66865b" opacity=".3"/></pattern>
            </defs>
            <rect width="640" height="480" fill="#91a77b"/><rect x="36" y="92" width="576" height="368" fill="#9db28a"/><rect x="36" y="92" width="576" height="368" fill="url(#grass-pattern)"/>
            <g v-for="area in CAMPUS_AREAS" :key="area.id">
              <rect v-if="area.rect" :x="area.rect[0]" :y="area.rect[1]" :width="area.rect[2]-area.rect[0]" :height="area.rect[3]-area.rect[1]" :fill="areaColor(area.type)" opacity=".55" rx="3"/>
              <polygon v-if="area.polygon" :points="area.polygon.map(p=>p.join(',')).join(' ')" fill="#6bb8b4" stroke="#d7e5d3" stroke-width="3"/>
            </g>
            <g v-if="showGrid"><rect x="36" y="92" width="576" height="368" fill="url(#map-grid)"/></g>
            <g v-for="road in roads" :key="road.id">
              <polyline :points="road.points.map(p=>p.join(',')).join(' ')" fill="none" stroke="#e0d8bd" :stroke-width="(road.width || 13)+5" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline :points="road.points.map(p=>p.join(',')).join(' ')" fill="none" :stroke="selected.id===road.id ? '#d59a43' : '#777b73'" :stroke-width="road.width || 13" stroke-linecap="round" stroke-linejoin="round" @click.stop="selected={type:'road',id:road.id}"/>
              <g v-if="selected.id===road.id"><circle v-for="(node,index) in road.points" :key="index" :cx="node[0]" :cy="node[1]" r="5" fill="#f0bc61" stroke="#3c4a3d" stroke-width="2" @pointerdown="startRoadNodeDrag($event,road,index)"/></g>
            </g>
            <g v-for="item in buildings" :key="item.id" class="building" @pointerdown="startBuildingDrag($event,item)" @click.stop="selected={type:'building',id:item.id}">
              <rect :x="item.rect[0]" :y="item.rect[1]" :width="item.rect[2]-item.rect[0]" :height="item.rect[3]-item.rect[1]" rx="2" fill="#bca27c" stroke="#665744" stroke-width="2"/>
              <rect :x="item.rect[0]+3" :y="item.rect[1]+3" :width="item.rect[2]-item.rect[0]-6" :height="item.rect[3]-item.rect[1]-6" fill="#d6c19b" stroke="#8f7859"/>
              <path :d="`M${item.rect[0]+5} ${item.rect[1]+5} L${item.rect[2]-5} ${item.rect[1]+5} L${item.rect[2]-5} ${item.rect[3]-5} L${item.rect[0]+5} ${item.rect[3]-5} Z`" fill="none" stroke="#f0e5ce" stroke-width="2"/>
              <text :x="(item.rect[0]+item.rect[2])/2" :y="(item.rect[1]+item.rect[3])/2+3" text-anchor="middle" font-size="8" fill="#514634">{{ item.label }}</text>
              <rect v-if="selected.id===item.id" :x="item.rect[0]-3" :y="item.rect[1]-3" :width="item.rect[2]-item.rect[0]+6" :height="item.rect[3]-item.rect[1]+6" fill="none" stroke="#e6a84c" stroke-width="2" stroke-dasharray="5 3"/>
            </g>
            <g fill="#3f724c" stroke="#d8dfc6" stroke-width="1.5"><g v-for="(tree,index) in [[202,215],[305,210],[355,280],[190,360],[520,275],[565,355],[225,420],[330,430],[485,435],[75,220],[85,260],[570,180]]" :key="index"><circle :cx="tree[0]" :cy="tree[1]" r="7"/><circle :cx="tree[0]-4" :cy="tree[1]+2" r="4"/></g></g>
            <g fill="#435844" font-size="10" font-weight="700"><text x="260" y="178">中心湖区</text><text x="548" y="105">运动场</text><text x="75" y="386">运动场</text></g>
          </svg>
        </div>
        <footer class="stage-footer"><span>画布：校园平面示意图 640 × 480</span><span>对象 {{ buildings.length }} 栋建筑 · {{ roads.length }} 条道路</span><span>坐标来源：校园原图标注</span></footer>
      </main>
      <aside class="inspector">
        <div class="panel-title">属性检查器</div>
        <div class="selected-card"><small>当前选中</small><strong>{{ selectedLabel }}</strong><span>{{ selected.type==='road' ? '道路 / LineString' : selected.type==='building' ? '建筑 / Footprint' : '请选择场景对象' }}</span></div>
        <template v-if="selectedBuilding">
          <label>建筑名称</label><input v-model="selectedBuilding.label">
          <label>空间范围</label><div class="coordinate-grid"><span>X₁ {{ Math.round(selectedBuilding.rect[0]) }}</span><span>Y₁ {{ Math.round(selectedBuilding.rect[1]) }}</span><span>X₂ {{ Math.round(selectedBuilding.rect[2]) }}</span><span>Y₂ {{ Math.round(selectedBuilding.rect[3]) }}</span></div>
          <label>数据可信度</label><span class="confidence">{{ selectedBuilding.confidence || 'unverified' }}</span>
          <button class="add-button" @click="rotateBuilding">↻ 旋转 90°</button><button class="danger-button" @click="deleteSelected">删除建筑</button>
        </template>
        <template v-else-if="selectedRoad">
          <label>道路宽度</label><input v-model.number="selectedRoad.width" type="range" min="4" max="24">
          <p class="hint">拖动地图上的圆形控制点调整道路路径。</p><button class="danger-button" @click="deleteSelected">删除道路</button>
        </template>
        <div v-else class="empty-inspector">在校园平面图中选择一栋建筑或一条道路。</div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.campus-editor{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;background:#e9e8dc;color:#283b30;font-family:Inter,"Microsoft YaHei",sans-serif}.editor-header{height:64px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 22px;background:#f8f7ef;border-bottom:1px solid #c9cbbb}.brand,.header-actions{display:flex;align-items:center;gap:12px}.brand-mark{display:grid;place-items:center;width:36px;height:36px;background:#315b43;color:#f4e8c9;font-weight:800}.brand strong,.brand small{display:block}.brand strong{font-size:14px}.brand small{font-size:9px;letter-spacing:1.4px;color:#788477;margin-top:4px}.header-actions button,.tool-panel button,.inspector button{border:1px solid #c9cbbb;background:#fffdf5;color:#344b3b;border-radius:3px;padding:8px 11px;font-size:12px;cursor:pointer}.header-actions button:disabled{opacity:.4}.header-actions .primary,.add-button{background:#315b43!important;color:#fff!important;border-color:#315b43!important}.zoom-value{font-size:11px;min-width:36px;text-align:center}.workspace{display:grid;grid-template-columns:190px minmax(0,1fr) 220px;min-height:0;flex:1}.tool-panel,.inspector{background:#f7f6ed;padding:17px 14px;border-right:1px solid #d1d2c5;overflow:auto}.inspector{border-right:0;border-left:1px solid #d1d2c5}.panel-title{font-size:11px;font-weight:800;letter-spacing:1px;color:#607363;margin:2px 0 13px}.tool-panel>button{width:100%;text-align:left;margin-bottom:7px}.tool-panel>button span{display:inline-block;width:23px;font-size:17px}.tool-panel>button.active{background:#e4eadc;border-color:#66866b}.panel-separator{height:1px;background:#d8d9cc;margin:17px 0}.tool-panel select,.inspector input:not([type=range]){width:100%;box-sizing:border-box;border:1px solid #c9cbbb;padding:8px;background:white;margin:7px 0 10px;color:#344b3b}.tool-panel label,.inspector label{display:block;font-size:11px;color:#69766a;margin:14px 0 5px}.tool-panel label b{float:right}.tool-panel input[type=range],.inspector input[type=range]{width:100%;accent-color:#527b58}.road-title{margin-top:22px}.hint{font-size:10px;line-height:1.7;color:#7b867a;margin-top:20px}.map-stage{display:flex;flex-direction:column;min-width:0;background:#d8ddcf}.stage-label{height:38px;display:flex;align-items:center;gap:8px;padding:0 16px;font-size:10px;font-weight:800;letter-spacing:1.1px;color:#4f6653}.stage-label em{font-style:normal;font-weight:400;letter-spacing:0;color:#899184}.live-dot{width:7px;height:7px;border-radius:50%;background:#72965c}.map-scroll{flex:1;min-height:0;overflow:auto;display:grid;place-items:center;padding:18px}.campus-map{width:min(100%,1050px);height:auto;max-height:100%;background:#91a77b;box-shadow:0 12px 35px #384a3528;transform-origin:center;touch-action:none}.building{cursor:move}.building:hover rect:first-child{stroke:#d69c43}.stage-footer{height:32px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:9px;color:#738071;background:#e8e9df}.selected-card{padding:12px;background:#e9eddf;border:1px solid #d1d9c8;margin-bottom:16px}.selected-card small,.selected-card strong,.selected-card span{display:block}.selected-card small{font-size:9px;color:#87917e}.selected-card strong{font-size:13px;margin:6px 0}.selected-card span{font-size:10px;color:#6e7d6e}.coordinate-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.coordinate-grid span{padding:7px;background:#eceee5;font-size:10px}.confidence{font-size:10px;color:#9a7542}.inspector .add-button,.inspector .danger-button{width:100%;margin-top:14px}.danger-button{border-color:#d8b7a9!important;color:#9b4d37!important;background:#fff8f4!important}.empty-inspector{font-size:11px;line-height:1.8;color:#879184;padding:20px 0}@media(max-width:900px){.workspace{grid-template-columns:150px minmax(0,1fr)}.inspector{display:none}.editor-header{padding:0 10px}.header-actions{gap:4px}.header-actions button{padding:7px}.brand small{display:none}}@media(max-width:600px){.workspace{grid-template-columns:112px minmax(0,1fr)}.tool-panel{padding:10px 7px}.tool-panel>button{font-size:10px;padding:7px 5px}.stage-footer span:last-child{display:none}.header-actions button:nth-child(3){display:none}}
</style>
