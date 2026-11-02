<script setup>
import { computed, onMounted, ref } from 'vue'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'
const campus = ref(null)
const map = ref(null)
const layers = ref([])
const features = ref([])
const activeLayer = ref(null)
const selectedFeature = ref(null)
const featureName = ref('')
const points = ref([])
const canvasWidth = ref(1000)
const canvasHeight = ref(700)
const backgroundUrl = ref('')
const backgroundName = ref('')
const status = ref('正在连接地图服务…')
const busy = ref(false)
const error = ref('')
const fileInput = ref(null)
const tool = ref('select')
const canvasSvg = ref(null)
const editingGeometry = ref(null)
const draggingVertex = ref(-1)

const headers = { 'Content-Type': 'application/json', 'X-Dev-User-Id': USER_ID }
const activeFeatures = computed(() => features.value.filter(item => String(item.layer_id) === String(activeLayer.value?.id)))
const selectedGeometry = computed(() => selectedFeature.value?.geometry)
const selectedRing = computed(() => editingGeometry.value?.type === 'Polygon' ? editingGeometry.value.coordinates?.[0] || [] : [])
const drawPoints = computed(() => selectedGeometry.value?.coordinates?.[0]?.slice(0, -1) || points.value)

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || `请求失败：HTTP ${response.status}`)
  return payload
}

async function initialize() {
  busy.value = true
  error.value = ''
  try {
    const campuses = await api('/campuses')
    campus.value = campuses.find(item => item.slug === 'ncgxy') || await api('/campuses', {
      method: 'POST', body: JSON.stringify({ slug: 'ncgxy', name: '南昌工学院', address: '江西省南昌市红谷滩区狮子山大道998号' }),
    })
    const maps = await api(`/campuses/${campus.value.id}/maps`)
    map.value = maps.find(item => item.slug === 'main') || await api(`/campuses/${campus.value.id}/maps`, {
      method: 'POST', body: JSON.stringify({ slug: 'main', name: '主校区', coordinateSystem: 'campus-local', coordinateUnit: 'pixel', canvasWidth: canvasWidth.value, canvasHeight: canvasHeight.value }),
    })
    canvasWidth.value = Number(map.value.canvas_width || map.value.canvasWidth || 1000)
    canvasHeight.value = Number(map.value.canvas_height || map.value.canvasHeight || 700)
    await loadMapData()
    status.value = '已连接 PostGIS 地图数据服务'
  } catch (e) {
    error.value = e.message
    status.value = '连接失败'
  } finally { busy.value = false }
}

async function loadMapData() {
  const base = `/campuses/${campus.value.id}/maps/${map.value.id}`
  layers.value = await api(`${base}/layers`)
  if (!layers.value.length) {
    const defaults = [
      ['buildings', '建筑轮廓', 'building'],
      ['roads', '道路', 'road'],
      ['water', '水体', 'water'],
      ['green', '绿地', 'green'],
      ['boundary', '校园边界', 'boundary'],
    ]
    for (const [key, name, featureType] of defaults) {
      layers.value.push(await api(`${base}/layers`, { method: 'POST', body: JSON.stringify({ key, name, featureType }) }))
    }
  }
  activeLayer.value = layers.value.find(layer => layer.feature_type === 'building') || layers.value[0]
  features.value = await api(`${base}/features`)
}

function pointFromEvent(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  return [
    Math.round((event.clientX - rect.left) / rect.width * canvasWidth.value * 100) / 100,
    Math.round((event.clientY - rect.top) / rect.height * canvasHeight.value * 100) / 100,
  ]
}

function canvasClick(event) {
  if (tool.value !== 'polygon' || activeLayer.value?.locked) return
  const point = pointFromEvent(event)
  points.value.push(point)
}

function featureClick(feature) {
  if (tool.value === 'polygon') return
  selectedFeature.value = feature
  editingGeometry.value = feature.geometry ? JSON.parse(JSON.stringify(feature.geometry)) : null
  featureName.value = feature.name || feature.properties?.name || ''
  points.value = []
  tool.value = 'select'
}

function startPolygon() {
  if (!activeLayer.value) return
  selectedFeature.value = null
  editingGeometry.value = null
  featureName.value = ''
  points.value = []
  tool.value = 'polygon'
}

async function savePolygon() {
  if (points.value.length < 3) { error.value = '建筑轮廓至少需要 3 个顶点'; return }
  const ring = [...points.value, points.value[0]]
  const geometry = { type: 'Polygon', coordinates: [ring] }
  busy.value = true
  error.value = ''
  try {
    const feature = await api(`/campuses/${campus.value.id}/maps/${map.value.id}/features`, {
      method: 'POST',
      body: JSON.stringify({
        featureKey: `ncgxy-${activeLayer.value.key}-${Date.now()}`,
        layerId: String(activeLayer.value.id),
        name: featureName.value.trim() || '未命名建筑',
        geometry,
        properties: { source: 'manual-digitization', confidence: 'unverified', coordinateUnit: map.value.coordinate_unit || 'pixel' },
      }),
    })
    features.value.push(feature)
    selectedFeature.value = feature
    tool.value = 'select'
    points.value = []
    status.value = '轮廓已保存至 PostGIS'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}


function svgPoint(event) {
  const svg = canvasSvg.value
  if (!svg) return [0, 0]
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(svg.getScreenCTM().inverse())
  return [Math.round(local.x * 100) / 100, Math.round(local.y * 100) / 100]
}

function beginVertexDrag(event, index) {
  if (!editingGeometry.value || editingGeometry.value.type !== 'Polygon') return
  draggingVertex.value = index
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function moveVertex(event) {
  if (draggingVertex.value < 0 || !editingGeometry.value) return
  const ring = editingGeometry.value.coordinates[0]
  const point = svgPoint(event)
  ring.splice(draggingVertex.value, 1, point)
  if (draggingVertex.value === 0) ring[ring.length - 1] = [...point]
}

function endVertexDrag() { draggingVertex.value = -1 }

async function updateSelected() {
  if (!selectedFeature.value) return
  busy.value = true
  error.value = ''
  try {
    const updated = await api(`/campuses/${campus.value.id}/maps/${map.value.id}/features/${selectedFeature.value.id}`, {
      method: 'PUT',
      body: JSON.stringify({ revision: selectedFeature.value.revision, name: featureName.value.trim() || '未命名要素', ...(editingGeometry.value ? { geometry: editingGeometry.value } : {}) }),
    })
    const index = features.value.findIndex(item => String(item.id) === String(updated.id))
    if (index >= 0) features.value[index] = updated
    selectedFeature.value = updated
    editingGeometry.value = updated.geometry ? JSON.parse(JSON.stringify(updated.geometry)) : null
    status.value = '属性与几何已保存'
  } catch (e) {
    error.value = e.message.includes('409') || e.message.includes('版本') ? '数据版本冲突，请刷新地图数据后重试' : e.message
  } finally { busy.value = false }
}

async function refreshData() {
  if (!campus.value || !map.value) return
  busy.value = true
  try { await loadMapData(); selectedFeature.value = null; status.value = '数据已刷新' }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}

function chooseBackground(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) { error.value = '请选择 PNG、JPG 或 WebP 图片'; return }
  if (backgroundUrl.value) URL.revokeObjectURL(backgroundUrl.value)
  backgroundUrl.value = URL.createObjectURL(file)
  backgroundName.value = file.name
}

function clearDraft() { points.value = []; tool.value = 'select' }
function undoPoint() { points.value.pop() }
onMounted(initialize)
</script>

<template>
  <section class="map-editor">
    <header class="editor-header">
      <div class="editor-brand"><span class="editor-mark">NC</span><div><strong>南昌工学院 · 地图数据工作台</strong><small>2D MAP EDITOR / POSTGIS</small></div></div>
      <div class="editor-header-right"><span class="connection"><i></i>{{ status }}</span><button class="editor-button ghost" @click="$emit('close')">返回三维地图</button></div>
    </header>
    <div class="editor-body">
      <aside class="editor-sidebar">
        <div class="panel-section"><div class="panel-title">项目空间</div><strong>{{ campus?.name || '南昌工学院' }}</strong><small>{{ map?.name || '主校区' }} · {{ canvasWidth }} × {{ canvasHeight }}</small></div>
        <div class="panel-section"><div class="panel-title">底图管理</div><button class="editor-button full" @click="fileInput?.click()">导入底图图片</button><input ref="fileInput" hidden type="file" accept="image/png,image/jpeg,image/webp" @change="chooseBackground"><small>{{ backgroundName || '尚未导入底图' }}</small><p class="muted">底图当前仅在本次浏览会话中显示，不会上传或持久化。</p></div>
        <div class="panel-section"><div class="panel-title">图层</div><button v-for="layer in layers" :key="layer.id" class="layer-row" :class="{ active: activeLayer?.id === layer.id }" @click="activeLayer = layer; selectedFeature = null"><span class="layer-dot" :class="layer.feature_type"></span><span>{{ layer.name }}</span><small>{{ features.filter(f => String(f.layer_id) === String(layer.id)).length }}</small></button></div>
        <div class="panel-section"><div class="panel-title">绘制工具</div><button class="tool-row" :class="{ active: tool === 'select' }" @click="tool = 'select'">↖ <span>选择 / 查看要素</span></button><button class="tool-row" :class="{ active: tool === 'polygon' }" :disabled="activeLayer?.locked" @click="startPolygon">⬡ <span>绘制多边形</span></button><div v-if="tool === 'polygon'" class="draft-actions"><small>已采集 {{ points.length }} 个顶点</small><button @click="undoPoint">撤销顶点</button><button @click="clearDraft">取消绘制</button></div></div>
        <div class="panel-section"><div class="panel-title">数据质量</div><p class="quality-note">新绘制要素默认标记为 <b>unverified</b>。未经底图配准和现场核验，不作为真实测绘成果。</p></div>
      </aside>
      <main class="editor-workspace">
        <div class="workspace-toolbar"><div><strong>{{ activeLayer?.name || '地图画布' }}</strong><small>坐标系：campus-local · 单位：{{ map?.coordinate_unit || 'pixel' }}</small></div><div class="toolbar-actions"><button class="editor-button ghost" @click="refreshData">刷新数据</button><button v-if="tool === 'polygon'" class="editor-button primary" :disabled="busy || points.length < 3" @click="savePolygon">保存轮廓</button></div></div>
        <div class="canvas-wrap">
          <svg ref="canvasSvg" class="map-canvas" :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`" preserveAspectRatio="xMidYMid meet" @click="canvasClick" @pointermove="moveVertex" @pointerup="endVertexDrag" @pointercancel="endVertexDrag">
            <defs><pattern id="editor-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="#d9e0dc" stroke-width="0.7"/></pattern></defs>
            <rect :width="canvasWidth" :height="canvasHeight" fill="#f4f6f2"/><rect :width="canvasWidth" :height="canvasHeight" fill="url(#editor-grid)"/>
            <image v-if="backgroundUrl" :href="backgroundUrl" :width="canvasWidth" :height="canvasHeight" preserveAspectRatio="none" opacity=".82"/>
            <g v-for="feature in activeFeatures" :key="feature.id" @click.stop="featureClick(feature)">
              <polygon v-if="feature.geometry?.type === 'Polygon'" :points="(selectedFeature?.id === feature.id && editingGeometry?.type === 'Polygon' ? editingGeometry.coordinates[0] : feature.geometry.coordinates[0]).map(p => p.join(',')).join(' ')" :class="['feature-shape', { selected: selectedFeature?.id === feature.id }]" />
              <polyline v-else-if="feature.geometry?.type === 'LineString'" :points="feature.geometry.coordinates.map(p => p.join(',')).join(' ')" class="feature-line"/>
              <circle v-else-if="feature.geometry?.type === 'Point'" :cx="feature.geometry.coordinates[0]" :cy="feature.geometry.coordinates[1]" r="5" class="feature-point"/>
              <text v-if="feature.geometry?.type === 'Polygon'" :x="feature.geometry.coordinates[0][0][0]" :y="feature.geometry.coordinates[0][0][1] - 5" class="feature-label">{{ feature.name || '未命名' }}</text>
            </g>
            <g v-if="selectedFeature && editingGeometry?.type === 'Polygon'" class="vertex-edit-handles"><circle v-for="(point,index) in selectedRing.slice(0,-1)" :key="index" :cx="point[0]" :cy="point[1]" r="6" class="edit-vertex" @pointerdown.stop.prevent="beginVertexDrag($event,index)" /></g>
            <polyline v-if="points.length" :points="points.map(p => p.join(',')).join(' ')" class="draft-line"/>
            <polygon v-if="points.length >= 3" :points="points.map(p => p.join(',')).join(' ')" class="draft-polygon"/>
            <circle v-for="(point,index) in points" :key="index" :cx="point[0]" :cy="point[1]" r="4" class="draft-vertex"/>
          </svg>
          <div v-if="tool === 'polygon'" class="canvas-hint">点击画布逐点绘制建筑轮廓，至少 3 个顶点后保存</div>
          <div v-if="!features.length && !points.length" class="empty-canvas">导入校园平面图，或直接在画布上开始矢量化</div>
        </div>
        <div class="workspace-footer"><span>当前图层：{{ activeLayer?.name || '—' }}</span><span>要素数：{{ activeFeatures.length }}</span><span>草稿顶点：{{ points.length }}</span><span>数据存储：PostgreSQL / PostGIS</span></div>
      </main>
      <aside class="editor-inspector">
        <div class="panel-title">要素属性</div>
        <template v-if="selectedFeature"><label>名称</label><input v-model="featureName" maxlength="160" placeholder="输入要素名称"><label>要素 ID</label><code>{{ selectedFeature.id }}</code><label>数据版本</label><code>revision {{ selectedFeature.revision }}</code><label>质量状态</label><code>{{ selectedFeature.properties?.confidence || 'unknown' }}</code><p v-if="editingGeometry?.type === 'Polygon'" class="muted">拖动地图上的白色顶点可调整建筑轮廓，完成后保存。</p><button class="editor-button primary full" :disabled="busy" @click="updateSelected">保存属性</button></template>
        <template v-else-if="tool === 'polygon'"><label>要素名称</label><input v-model="featureName" maxlength="160" placeholder="例如：第一教学楼"><p class="muted">完成轮廓绘制后保存。建筑名称和坐标需后续核验。</p></template>
        <div v-else class="inspector-empty">选择地图中的一个要素，查看或编辑其属性。</div>
        <div v-if="error" class="editor-error">{{ error }}</div>
      </aside>
    </div>
    <footer class="editor-footer"><span>南昌工学院主校区 · 数据编辑模式</span><span>本地坐标仅用于底图矢量化，不等同于真实地理坐标</span></footer>
  </section>
</template>

<style scoped>
.map-editor{position:absolute;z-index:30;inset:0;display:flex;flex-direction:column;background:#eef1ed;color:#26332f;font-family:Arial,"Microsoft YaHei",sans-serif}.editor-header{height:66px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:#172622;color:#f4f5ef}.editor-brand,.editor-header-right{display:flex;align-items:center;gap:13px}.editor-mark{display:grid;place-items:center;width:36px;height:36px;border:1px solid #c8ad72;color:#d9c18f;font-size:12px;font-weight:700}.editor-brand strong,.editor-brand small{display:block}.editor-brand strong{font-size:14px}.editor-brand small{margin-top:4px;color:#aab8af;font-size:9px;letter-spacing:1.5px}.connection{font-size:11px;color:#c5d3c9}.connection i{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:#75b58a}.editor-body{display:grid;grid-template-columns:230px minmax(0,1fr) 250px;gap:0;min-height:0;flex:1}.editor-sidebar,.editor-inspector{overflow:auto;background:#fff;padding:18px 16px;border-right:1px solid #dce2dc}.editor-inspector{border-right:0;border-left:1px solid #dce2dc}.panel-section{padding:0 0 17px;margin-bottom:17px;border-bottom:1px solid #e8ece7}.panel-title{margin-bottom:12px;color:#6f7c74;font-size:10px;font-weight:700;letter-spacing:1px}.panel-section strong{display:block;font-size:13px}.panel-section small,.workspace-toolbar small{display:block;margin-top:6px;color:#859189;font-size:10px}.muted,.quality-note{color:#859189;font-size:10px;line-height:1.7}.quality-note b{color:#a46f36}.editor-button{height:32px;padding:0 12px;border:1px solid #d6ded7;border-radius:4px;background:#fff;color:#46554c;font-size:11px;cursor:pointer}.editor-button.primary{border-color:#29483b;background:#29483b;color:#fff}.editor-button.ghost:hover,.layer-row:hover,.tool-row:hover{background:#f1f5f1}.editor-button:disabled{opacity:.45;cursor:not-allowed}.editor-button.full{width:100%}.layer-row,.tool-row{width:100%;display:flex;align-items:center;gap:9px;padding:9px 7px;border:0;background:transparent;color:#425148;text-align:left;font-size:11px;cursor:pointer}.layer-row.active,.tool-row.active{background:#edf3ee;color:#234a37}.layer-row small{margin:0 0 0 auto}.layer-dot{width:8px;height:8px;border-radius:2px;background:#9aa69e}.layer-dot.building{background:#c18d64}.layer-dot.road{background:#9b9d93}.layer-dot.water{background:#73a9bd}.layer-dot.green{background:#7b9e78}.draft-actions{display:flex;flex-wrap:wrap;gap:7px;padding:6px}.draft-actions small{width:100%;color:#76847a}.draft-actions button{border:0;background:none;color:#466d54;font-size:10px;cursor:pointer}.editor-workspace{display:flex;flex-direction:column;min-width:0;padding:16px 18px}.workspace-toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.workspace-toolbar strong{font-size:13px}.toolbar-actions{display:flex;gap:8px}.canvas-wrap{position:relative;display:flex;align-items:center;justify-content:center;flex:1;min-height:0;overflow:hidden;border:1px solid #d7ded7;background:#e5eae5}.map-canvas{display:block;width:100%;height:100%;max-width:100%;max-height:100%;cursor:crosshair}.feature-shape{fill:#d7b69a;fill-opacity:.72;stroke:#986d4e;stroke-width:2;cursor:pointer}.feature-shape.selected{fill:#e7a96f;stroke:#8b4d1f;stroke-width:3}.feature-line{fill:none;stroke:#89918b;stroke-width:4}.feature-point{fill:#527d9a}.edit-vertex{fill:#fff;stroke:#315f49;stroke-width:2;cursor:move;pointer-events:all}.feature-label{fill:#554538;font-size:12px;pointer-events:none}.draft-line{fill:none;stroke:#315f49;stroke-width:2;stroke-dasharray:7 4}.draft-polygon{fill:#75a987;fill-opacity:.3;stroke:#315f49;stroke-width:2}.draft-vertex{fill:#fff;stroke:#315f49;stroke-width:2}.canvas-hint,.empty-canvas{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:8px 12px;border:1px solid #d6ded7;border-radius:4px;background:rgba(255,255,255,.92);color:#5e6b62;font-size:10px;white-space:nowrap;pointer-events:none}.empty-canvas{top:50%;bottom:auto;transform:translate(-50%,-50%);background:rgba(255,255,255,.82)}.workspace-footer{display:flex;justify-content:space-between;gap:8px;padding-top:11px;color:#7b887f;font-size:9px}.editor-inspector label{display:block;margin:17px 0 6px;color:#78847b;font-size:10px}.editor-inspector input{width:100%;height:34px;padding:0 9px;border:1px solid #d6ded7;border-radius:4px;outline:none;font-size:11px}.editor-inspector input:focus{border-color:#668c72}.editor-inspector code{display:block;padding:8px;background:#f3f5f2;color:#526056;font-size:10px;overflow-wrap:anywhere}.editor-inspector .editor-button{margin-top:18px}.inspector-empty{padding:18px 0;color:#89948d;font-size:11px;line-height:1.8}.editor-error{margin-top:14px;padding:9px;background:#fff0ed;color:#a14335;font-size:10px;line-height:1.6}.editor-footer{height:28px;flex:none;display:flex;justify-content:space-between;align-items:center;padding:0 18px;background:#e2e8e2;color:#758178;font-size:9px}@media(max-width:900px){.editor-body{grid-template-columns:190px minmax(0,1fr)}.editor-inspector{display:none}.workspace-footer span:last-child{display:none}}@media(max-width:620px){.editor-header{height:54px;padding:0 12px}.editor-header-right .connection{display:none}.editor-body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.editor-sidebar{display:flex;gap:12px;overflow-x:auto;padding:8px;border-right:0;border-bottom:1px solid #dce2dc}.panel-section{min-width:150px;padding:0 8px 4px;margin:0;border:0}.panel-section:nth-child(5){display:none}.editor-workspace{padding:9px}.workspace-footer{font-size:8px;flex-wrap:wrap}.editor-footer span:last-child{display:none}.empty-canvas{max-width:90%;white-space:normal;text-align:center}}
</style>
