<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { validateCampusFeature, validateCampusGeometry } from '../data/campus/campusLayoutV2.js'

const emit = defineEmits(['close'])
const imageUrl = ref('')
const imageName = ref('未加载参考图')
const imageWidth = ref(640)
const imageHeight = ref(480)
const sourceRef = ref('freshman-guide-2026-campus-plan')
const featureType = ref('boundary')
const drawMode = ref('draw')
const status = ref('draft')
const confidence = ref('medium')
const featureName = ref('')
const features = ref([])
const history = ref([])
const activePoints = ref([])
const selectedId = ref('')
const message = ref('先加载校园平面图，再选择要素类型并在底图上绘制。')
const collectionByType = { boundary: 'boundary', entrance: 'entrances', road: 'roads', 'water-body': 'waterBodies', bridge: 'bridges', 'sports-ground': 'sportsGrounds', 'building-cluster': 'buildingClusters', building: 'buildings', 'green-space': 'greenSpaces', landmark: 'landmarks' }
const typeByCollection = Object.fromEntries(Object.entries(collectionByType).map(([type, collection]) => [collection, type]))
const typeOptions = [
  { value: 'boundary', label: '校园边界', geometry: 'Polygon' },
  { value: 'entrance', label: '出入口', geometry: 'Point' },
  { value: 'road', label: '道路中心线', geometry: 'LineString' },
  { value: 'water-body', label: '湖泊 / 水体', geometry: 'Polygon' },
  { value: 'bridge', label: '桥梁', geometry: 'LineString' },
  { value: 'sports-ground', label: '运动场', geometry: 'Polygon' },
  { value: 'building-cluster', label: '建筑组团', geometry: 'Polygon' },
  { value: 'building', label: '单体建筑', geometry: 'Polygon' },
  { value: 'green-space', label: '绿地', geometry: 'Polygon' },
  { value: 'landmark', label: '地标', geometry: 'Point' },
]
const selectedFeature = computed(() => features.value.find(item => item.id === selectedId.value) || null)
const activeType = computed(() => typeOptions.find(item => item.value === featureType.value) || typeOptions[0])
const validDraft = computed(() => {
  const geometry = draftGeometry()
  return geometry && validateCampusGeometry(geometry, imageWidth.value, imageHeight.value)
})
function draftGeometry() {
  if (activeType.value.geometry === 'Point') return activePoints.value.length === 1 ? { type: 'Point', coordinates: activePoints.value[0] } : null
  if (activeType.value.geometry === 'LineString') return activePoints.value.length >= 2 ? { type: 'LineString', coordinates: activePoints.value } : null
  if (activePoints.value.length >= 3) {
    const points = [...activePoints.value]
    if (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1]) points.push([...points[0]])
    return { type: 'Polygon', coordinates: [points] }
  }
  return null
}
function onImageChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { message.value = '仅支持 PNG、JPG、WebP 图片'; return }
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = URL.createObjectURL(file)
  imageName.value = file.name
  const image = new Image()
  image.onload = () => {
    imageWidth.value = image.naturalWidth
    imageHeight.value = image.naturalHeight
    activePoints.value = []
    message.value = '底图已加载：' + imageWidth.value + ' × ' + imageHeight.value + ' px。当前为本地工作区，导出 JSON 后保存成果。'
  }
  image.onerror = () => { message.value = '图片解码失败，请检查文件' }
  image.src = imageUrl.value
  event.target.value = ''
}
function canvasPoint(event) {
  const svg = event.currentTarget
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(svg.getScreenCTM().inverse())
  return [Math.max(0, Math.min(imageWidth.value, Number(local.x.toFixed(2)))), Math.max(0, Math.min(imageHeight.value, Number(local.y.toFixed(2))))]
}
function addPoint(event) {
  if (drawMode.value !== 'draw') return
  if (activeType.value.geometry === 'Point') {
    activePoints.value = [canvasPoint(event)]
    finishFeature()
    return
  }
  activePoints.value.push(canvasPoint(event))
}
function snapshot() { history.value.push(JSON.stringify(features.value)); if (history.value.length > 80) history.value.shift() }
function undo() {
  const previous = history.value.pop()
  if (!previous) return
  features.value = JSON.parse(previous)
  selectedId.value = ''
  message.value = '已撤销上一步要素变更。'
}
function finishFeature() {
  const geometry = draftGeometry()
  if (!geometry || !validateCampusGeometry(geometry, imageWidth.value, imageHeight.value)) {
    message.value = activeType.value.geometry === 'Polygon' ? '面要素至少需要三个顶点' : '线要素至少需要两个点'
    return
  }
  snapshot()
  const id = featureType.value + '-' + Date.now().toString(36) + '-' + (features.value.length + 1)
  const feature = {
    id,
    type: featureType.value,
    name: featureName.value.trim() || activeType.value.label + ' ' + (features.value.length + 1),
    status: status.value,
    confidence: confidence.value,
    sourceRefs: [sourceRef.value.trim() || 'user-supplied-reference'],
    geometry,
    properties: {},
  }
  features.value.push(feature)
  selectedId.value = id
  activePoints.value = []
  featureName.value = ''
  message.value = '已添加 ' + feature.name + '。建议保存后继续标注。'
}
function onCanvasDoubleClick(event) {
  if (activeType.value.geometry === 'Point') return
  event.preventDefault()
  const last = activePoints.value.at(-1)
  const previous = activePoints.value.at(-2)
  if (last && previous && Math.hypot(last[0] - previous[0], last[1] - previous[1]) < 2) activePoints.value.pop()
  finishFeature()
}
function selectFeature(id) {
  if (drawMode.value === 'select') selectedId.value = id
}
function deleteSelected() {
  if (!selectedId.value) return
  snapshot()
  features.value = features.value.filter(item => item.id !== selectedId.value)
  selectedId.value = ''
  message.value = '已删除选中要素（仅本地未导出数据）。'
}
function clearDraft() { activePoints.value = [] }
function buildV2Document() {
  const collections = Object.fromEntries(Object.values(collectionByType).map(key => [key, []]))
  for (const feature of features.value) collections[collectionByType[feature.type]].push(feature)
  return {
    schemaVersion: '2.0.0',
    campusId: 'ncgxy-main-campus',
    coordinateSystem: {
      type: 'image-pixel', origin: 'top-left', xAxis: 'right', yAxis: 'down', unit: 'px',
      calibrationStatus: 'uncalibrated',
      referenceImage: {
        id: sourceRef.value.trim() || 'user-supplied-reference',
        title: imageName.value,
        width: imageWidth.value,
        height: imageHeight.value,
        rightsStatus: 'reference-only',
      },
    },
    calibration: null,
    features: collections,
  }
}
function exportJson() {
  const invalid = features.value.filter(item => !validateCampusFeature(item, imageWidth.value, imageHeight.value) || !collectionByType[item.type])
  if (invalid.length) { message.value = '存在 ' + invalid.length + ' 个不合规或未知类型要素，无法导出'; return }
  const blob = new Blob([JSON.stringify(buildV2Document(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'ncgxy-campus-layout-v2.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  message.value = '已导出符合 CAMPUS_LAYOUT_V2 结构的 ' + features.value.length + ' 个空间要素。'
}
function importJson(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const documentData = JSON.parse(String(reader.result || ''))
      if (documentData.schemaVersion !== '2.0.0' || documentData.campusId !== 'ncgxy-main-campus' || !documentData.features || Array.isArray(documentData.features)) {
        throw new Error('文件结构不符合校园空间 V2 标准')
      }
      const referenceImage = documentData.coordinateSystem?.referenceImage
      if (!Number.isFinite(referenceImage?.width) || !Number.isFinite(referenceImage?.height) || referenceImage.width <= 0 || referenceImage.height <= 0) {
        throw new Error('V2 文件缺少有效的参考图像素宽高')
      }
      const imported = []
      for (const [collection, items] of Object.entries(documentData.features)) {
        const type = typeByCollection[collection]
        if (!type || !Array.isArray(items)) throw new Error('未知要素集合或集合格式错误：' + collection)
        for (const item of items) {
          if (item.type !== type || !validateCampusFeature(item, referenceImage.width, referenceImage.height)) {
            throw new Error('要素校验失败：' + (item.id || '未命名要素'))
          }
          imported.push(item)
        }
      }
      snapshot()
      features.value = imported
      selectedId.value = ''
      imageWidth.value = referenceImage.width
      imageHeight.value = referenceImage.height
      imageName.value = referenceImage.title || file.name
      sourceRef.value = referenceImage.id || 'imported-reference'
      activePoints.value = []
      message.value = '已导入并校验 ' + imported.length + ' 个空间要素。请加载对应参考底图进行目视核对。'
    } catch (error) {
      message.value = '导入失败：' + (error.message || 'JSON 格式错误')
    }
  }
  reader.onerror = () => { message.value = '导入失败：无法读取文件' }
  reader.readAsText(file, 'utf-8')
  event.target.value = ''
}
function featurePath(feature) {
  const geometry = feature.geometry
  if (geometry.type === 'Polygon') return geometry.coordinates[0].map((point, index) => (index ? 'L' : 'M') + point[0] + ' ' + point[1]).join(' ') + ' Z'
  if (geometry.type === 'LineString') return geometry.coordinates.map((point, index) => (index ? 'L' : 'M') + point[0] + ' ' + point[1]).join(' ')
  return ''
}
function pointForFeature(feature) { return feature.geometry.type === 'Point' ? feature.geometry.coordinates : null }
onBeforeUnmount(() => { if (imageUrl.value) URL.revokeObjectURL(imageUrl.value) })
</script>

<template>
  <section class="vector-workspace">
    <header class="vector-header">
      <div><strong>南昌工学院 · V2 校园底图标注</strong><small>VECTORIZATION WORKSPACE / IMAGE PIXEL</small></div>
      <div class="vector-actions">
        <label class="file-button">加载参考图<input type="file" accept="image/png,image/jpeg,image/webp" @change="onImageChange"></label>
        <label class="file-button">导入 V2 JSON<input type="file" accept="application/json,.json" @change="importJson"></label>
        <button @click="undo" :disabled="!history.length">撤销</button><button @click="exportJson" :disabled="!features.length">导出 V2 JSON</button>
        <button @click="emit('close')">返回旧版编辑器</button>
      </div>
    </header>
    <div class="vector-layout">
      <aside class="vector-sidebar">
        <section class="vector-section">
          <h3>底图信息</h3>
          <p>{{ imageName }}</p>
          <p>{{ imageWidth }} × {{ imageHeight }} px</p>
          <p class="muted">坐标原点在左上角；当前不进行米制配准。导入 JSON 后请重新加载对应底图。</p>
          <label>来源 ID<input v-model="sourceRef" /></label>
        </section>
        <section class="vector-section">
          <h3>绘制设置</h3>
          <label>要素类型<select v-model="featureType" @change="clearDraft"><option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
          <label>操作模式<select v-model="drawMode" @change="clearDraft"><option value="draw">绘制要素</option><option value="select">选择要素</option></select></label>
          <label>要素名称<input v-model="featureName" placeholder="可留空自动命名" /></label>
          <label>核验状态<select v-model="status"><option value="unverified">未核验</option><option value="draft">初步标注</option><option value="verified">已核验</option></select></label>
          <label>置信度<select v-model="confidence"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <div class="hint">点：单击完成；线 / 面：逐点单击，双击结束。选择模式可点选已有要素。</div>
          <div class="button-row"><button @click="finishFeature" :disabled="!validDraft">完成当前要素</button><button @click="clearDraft" :disabled="!activePoints.length">清除草稿</button></div>
        </section>
        <section class="vector-section">
          <h3>要素清单 <span>{{ features.length }}</span></h3>
          <div class="feature-list">
            <button v-for="item in features" :key="item.id" :class="{selected: selectedId === item.id}" @click="selectFeature(item.id)">
              <strong>{{ item.name }}</strong><small>{{ item.type }} · {{ item.status }} · {{ item.confidence }}</small>
            </button>
            <p v-if="!features.length" class="muted">尚无已标注要素</p>
          </div>
          <button class="danger-button" :disabled="!selectedId" @click="deleteSelected">删除选中要素</button>
        </section>
      </aside>
      <main class="vector-canvas-wrap">
        <div class="canvas-toolbar"><span>{{ drawMode === 'draw' ? '绘制模式' : '选择模式' }} · {{ activeType.label }}</span><span>双击结束线 / 面</span></div>
        <div class="vector-canvas-scroll">
          <svg class="vector-canvas" :viewBox="'0 0 ' + imageWidth + ' ' + imageHeight" :style="{ aspectRatio: imageWidth + ' / ' + imageHeight }" @click="addPoint" @dblclick="onCanvasDoubleClick">
            <rect x="0" y="0" :width="imageWidth" :height="imageHeight" fill="#dce8d1" />
            <image v-if="imageUrl" :href="imageUrl" x="0" y="0" :width="imageWidth" :height="imageHeight" preserveAspectRatio="none" />
            <g v-for="item in features" :key="item.id" @click.stop="selectFeature(item.id)">
              <path v-if="item.geometry.type !== 'Point'" :d="featurePath(item)" :fill="item.geometry.type === 'Polygon' ? (selectedId === item.id ? '#f0a54a55' : '#428caa33') : 'none'" :stroke="selectedId === item.id ? '#d15e2e' : '#236b80'" :stroke-width="selectedId === item.id ? 3 : 2" vector-effect="non-scaling-stroke" />
              <circle v-if="item.geometry.type === 'Point'" :cx="pointForFeature(item)[0]" :cy="pointForFeature(item)[1]" r="5" :fill="selectedId === item.id ? '#d15e2e' : '#236b80'" stroke="white" stroke-width="1.5" vector-effect="non-scaling-stroke" />
            </g>
            <path v-if="activePoints.length > 1" :d="activePoints.map((point,index) => (index ? 'L' : 'M') + point[0] + ' ' + point[1]).join(' ')" fill="none" stroke="#d15e2e" stroke-width="2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" />
            <g v-for="(point,index) in activePoints" :key="index"><circle :cx="point[0]" :cy="point[1]" r="3" fill="#d15e2e" vector-effect="non-scaling-stroke" /></g>
          </svg>
        </div>
        <footer class="vector-status">{{ message }}</footer>
      </main>
    </div>
  </section>
</template>

<style scoped>
.vector-workspace{height:100%;min-height:0;display:flex;flex-direction:column;background:#eef1e9;color:#26352b;font:13px/1.5 Arial,"Microsoft YaHei",sans-serif}
.vector-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;background:#fff;border-bottom:1px solid #d9dfd5}
.vector-header strong{display:block;font-size:16px}.vector-header small{display:block;color:#788478;font-size:10px;letter-spacing:1px}
.vector-actions,.button-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vector-actions button,.button-row button,.danger-button,.file-button{border:1px solid #cbd5c9;border-radius:5px;padding:7px 11px;background:white;color:#34483a;cursor:pointer;font-size:12px}
.vector-actions button:first-of-type,.button-row button:first-child{background:#315f49;color:white;border-color:#315f49}
.vector-actions button:disabled,.button-row button:disabled,.danger-button:disabled{opacity:.4;cursor:not-allowed}
.file-button{position:relative;overflow:hidden}.file-button input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}
.vector-layout{display:grid;grid-template-columns:290px minmax(0,1fr);gap:12px;padding:12px;min-height:0;flex:1}
.vector-sidebar{overflow:auto;background:white;border:1px solid #dce2d8;border-radius:7px}
.vector-section{padding:14px;border-bottom:1px solid #e8ece5}.vector-section h3{margin:0 0 10px;font-size:13px}.vector-section h3 span{float:right;color:#788478}
.vector-section p{margin:4px 0;color:#4e5c50}.vector-section .muted,.muted{color:#929b91;font-size:11px}
.vector-section label{display:block;margin:9px 0;font-size:11px;color:#647165}
.vector-section input,.vector-section select{display:block;width:100%;margin-top:4px;padding:7px;border:1px solid #d8dfd5;border-radius:4px;background:#fff;color:#293a2e;font:12px Arial,"Microsoft YaHei",sans-serif}
.hint{margin:10px 0;padding:8px;background:#f3f5ef;border-radius:4px;color:#788478;font-size:11px}
.feature-list{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}.feature-list button{text-align:left;border:1px solid #e1e6de;border-radius:4px;padding:7px;background:#fff;color:#354639;cursor:pointer}.feature-list button.selected{border-color:#c8783b;background:#fff8ef}.feature-list strong,.feature-list small{display:block}.feature-list small{color:#879184;font-size:10px}
.danger-button{color:#a44737}
.vector-canvas-wrap{min-width:0;min-height:0;display:flex;flex-direction:column;background:white;border:1px solid #dce2d8;border-radius:7px;overflow:hidden}
.canvas-toolbar,.vector-status{display:flex;justify-content:space-between;padding:9px 12px;background:#f8faf6;color:#6d796d;font-size:11px;border-bottom:1px solid #e8ece5}
.vector-status{display:block;border-top:1px solid #e8ece5;border-bottom:0}
.vector-canvas-scroll{overflow:auto;flex:1;display:flex;align-items:flex-start;justify-content:center;padding:14px;background:#e7ebe3}
.vector-canvas{display:block;max-width:100%;height:auto;box-shadow:0 2px 14px #26352b22;cursor:crosshair;background:#dce8d1}
@media(max-width:760px){.vector-header{align-items:flex-start;flex-direction:column}.vector-layout{grid-template-columns:1fr;grid-template-rows:minmax(220px,38%) minmax(300px,1fr)}.vector-sidebar{display:grid;grid-template-columns:1fr 1fr;overflow:auto}.vector-section:last-child{grid-column:1/-1}}
</style>
