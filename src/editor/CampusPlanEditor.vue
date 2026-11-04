<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { rectToPolygon, movePolygon, rotatePolygon, polygonBounds, normalizeBuilding, roadToPolygon, roadNetworkToMultiPolygon, calculateWorkspaceBounds } from './campusEditorDocument.js'
import { fitCampusSimilarityTransform } from './campusMapCalibration.js'
import { createDraftGeometry } from './geometryDraft.js'
import { toCampusFeatureCollection, fromCampusFeatureCollection, mergeCampusFeatureCollections, createCampusFeatureSnapshot, restoreCampusFeatureSnapshot, updateCampusFeatureProperties, updateCampusFeatureGeometry, translateCampusFeatureGeometry, duplicateCampusFeature, upsertCampusFeature, removeCampusFeatures } from './campusFeatureCollection.js'
import { buildCampusGeoJSON } from '../data/campus/campusGeoJSON.js'
import { CAMPUS_BUILDING_ASSET_CATALOG, CAMPUS_BUILDING_TEMPLATES, validateBuildingFootprint } from '../three/world/campus/campusAssetLibrary.js'
import {
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_ROAD_CENTERLINES,
  CAMPUS_AREAS,
} from '../data/campus/campusLayout.js'

const props = defineProps({
  campusId: { type: [String, Number], default: '' },
  mapId: { type: [String, Number], default: '' },
  apiBase: { type: String, default: 'http://localhost:3001/api/v1' },
  devUserId: { type: String, default: 'map-editor-local' },
})
const emit = defineEmits(['close', 'preview'])
const documentRevision = ref(0)
const persistenceBusy = ref(false)
const persistenceMessage = ref('')
const persistenceState = ref('idle')
const savedAssetId = ref(null)
const documentLoaded = ref(false)
const revisionConflict = ref(false)
let autoSaveTimer = null
let lastSavedSnapshot = ''
const deletedFeatureIds = ref([])
const authHeaders = () => ({ 'X-Dev-User-Id': props.devUserId })
const mapApiPath = () => `/campuses/${props.campusId}/maps/${props.mapId}`
async function apiRequest(path, options = {}) {
  const response = await fetch(`${props.apiBase}${path}`, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } })
  const payload = options.raw ? await response.blob() : await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(typeof payload?.message === 'string' ? payload.message : `地图服务请求失败：HTTP ${response.status}`)
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}
async function loadEditorDocument() {
  if (!props.campusId || !props.mapId) return
  try {
    const saved = await apiRequest(`${mapApiPath()}/scene/plan`)
    let referenceImagePreviewError = ''
    documentRevision.value = Number(saved.revision || 0)
    const document = saved.document
    if (document?.coordinateSystem === 'campus-plan-pixel') {
      deletedFeatureIds.value = [...new Set([...(document.featureCollection?.deletedFeatureIds || []), ...(document.deletedFeatureIds || [])].map(String))]
      const baseCollection = BASE_CAMPUS_FEATURE_COLLECTION
      const savedCollection = document.featureCollection?.type === 'FeatureCollection'
        ? document.featureCollection
        : toCampusFeatureCollection(document)
      spatialFeatureCollection.value = mergeCampusFeatureCollections(baseCollection, {
        ...savedCollection,
        deletedFeatureIds: deletedFeatureIds.value,
      })
      deletedFeatureIds.value = spatialFeatureCollection.value.deletedFeatureIds
      const normalized = fromCampusFeatureCollection(spatialFeatureCollection.value)
      buildings.value = normalized.buildings.map(normalizeBuilding)
      areas.value = normalized.areas
      roads.value = normalized.roads
      objects.value = normalized.objects
      if (document.calibration?.controlPoints) calibrationPoints.value = document.calibration.controlPoints
      if (document.referenceImage) {
        referenceImage.value = document.referenceImage
        referenceImageOpacity.value = Number(document.referenceImage.opacity ?? 0.55)
        // 底图预览属于辅助资源；资源加载失败不能阻断规范空间文档加载和后续自动保存。
        if (document.referenceImage.assetId) {
          try {
            await loadAssetPreview(document.referenceImage.assetId)
          } catch (error) {
            referenceImagePreviewError = `底图预览加载失败：${error.message}`
          }
        }
      }
    }
    if (!spatialFeatureCollection.value.features.length) spatialFeatureCollection.value = toCampusFeatureCollection({ buildings: buildings.value, roads: roads.value, areas: areas.value, objects: objects.value, deletedFeatureIds: deletedFeatureIds.value })
    documentLoaded.value = true
    lastSavedSnapshot = JSON.stringify(buildDocument())
    persistenceState.value = saved.document ? 'saved' : 'idle'
    persistenceMessage.value = referenceImagePreviewError || (saved.document
      ? `已加载服务端版本 · ${documentRevision.value}`
      : '当前地图尚无服务端编辑文档，修改后将自动保存')
  } catch (error) {
    persistenceMessage.value = `读取已保存编辑文档失败：${error.message}`
  }
}
async function reloadEditorDocument() {
  // 冲突恢复必须先取消尚未触发的自动保存，避免旧本地快照抢在服务端重载完成前再次提交。
  if (autoSaveTimer) {
    window.clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  if (persistenceBusy.value) return
  documentLoaded.value = false
  revisionConflict.value = false
  await loadEditorDocument()
}
async function loadAssetPreview(assetId) {
  const asset = await apiRequest(`${mapApiPath()}/assets/${assetId}/content`, { raw: true })
  if (referenceImagePreview.value.startsWith('blob:')) URL.revokeObjectURL(referenceImagePreview.value)
  referenceImagePreview.value = URL.createObjectURL(asset)
  savedAssetId.value = assetId
}
async function saveEditorDocument() {
  if (!props.campusId || !props.mapId) {
    persistenceState.value = 'error'
    persistenceMessage.value = '缺少校园或地图 ID，无法持久化'
    return
  }
  if (persistenceBusy.value || revisionConflict.value) return
  const document = { ...buildDocument(), mapId: String(props.mapId) }
  const requestSnapshot = JSON.stringify(buildDocument())
  persistenceBusy.value = true
  persistenceState.value = 'saving'
  persistenceMessage.value = ''
  try {
    const saved = await apiRequest(`${mapApiPath()}/scene/plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: documentRevision.value, document }),
    })
    documentRevision.value = Number(saved.revision || documentRevision.value + 1)
    revisionConflict.value = false
    lastSavedSnapshot = requestSnapshot
    persistenceState.value = 'saved'
    persistenceMessage.value = `自动保存完成 · 版本 ${documentRevision.value}`
  } catch (error) {
    if (error.status === 409) {
      revisionConflict.value = true
      persistenceState.value = 'conflict'
      persistenceMessage.value = '检测到版本冲突：服务端已有其他编辑者的新版本。本地修改已保留，请导出本地版本或重新加载服务端版本。'
    } else {
      persistenceState.value = 'error'
      persistenceMessage.value = `保存失败：${error.message}`
    }
  } finally {
    persistenceBusy.value = false
    // 只在请求期间确实产生了新编辑时补发保存；失败且内容未变化时停止重试，
    // 避免网络/服务端持续异常导致每 500ms 无限自动请求。
    if (documentLoaded.value && !revisionConflict.value && JSON.stringify(buildDocument()) !== requestSnapshot) {
      if (autoSaveTimer) window.clearTimeout(autoSaveTimer)
      autoSaveTimer = window.setTimeout(() => {
        autoSaveTimer = null
        saveEditorDocument()
      }, 500)
    }
  }
}
const BASE_CAMPUS_FEATURE_COLLECTION = buildCampusGeoJSON()
const BASE_CAMPUS_FEATURE_IDS = new Set(BASE_CAMPUS_FEATURE_COLLECTION.features.map(feature => String(feature.id)))
const BASE_CAMPUS_BUILDINGS = CAMPUS_BUILDING_FOOTPRINTS.map(item => ({ ...normalizeBuilding(item), template: item.template || item.label || '教学楼' }))
const BASE_CAMPUS_AREAS = CAMPUS_AREAS.map(item => ({ ...item, footprint: item.polygon?.map(point => [...point]) || rectToPolygon(item.rect) }))
const BASE_CAMPUS_ROADS = CAMPUS_ROAD_CENTERLINES.map(item => ({ ...item, points: item.points.map(point => [...point]) }))
const BASE_CAMPUS_OBJECTS = BASE_CAMPUS_FEATURE_COLLECTION.features
  .filter(feature => feature.properties?.featureType === 'object' && feature.geometry?.type === 'Point')
  .map(feature => {
    const { featureType, name, source, qualityStatus, objectType, ...properties } = feature.properties
    return {
      id: String(feature.id),
      type: objectType || 'facility',
      name: name || '校园设施',
      geometry: { type: 'Point', coordinates: [...feature.geometry.coordinates] },
      // confidence 与 verificationStatus 都属于对象业务属性，必须保留。
      properties,
      source,
      qualityStatus: qualityStatus || properties.verificationStatus || 'unverified',
    }
  })
function mergeEditorLayer(baseItems, editedItems, deletedIds) {
  const byId = new Map(baseItems.map(item => [String(item.id), item]))
  for (const item of editedItems || []) byId.set(String(item.id), item)
  const deleted = new Set(deletedIds.map(String))
  return [...byId.values()].filter(item => !deleted.has(String(item.id)))
}
const buildings = ref(BASE_CAMPUS_BUILDINGS.map(item => ({ ...item })))
const areas = ref(BASE_CAMPUS_AREAS.map(item => ({ ...item })))
const roads = ref(BASE_CAMPUS_ROADS.map(item => ({ ...item })))
const objects = ref(BASE_CAMPUS_OBJECTS.map(item => ({ ...item, geometry: { ...item.geometry, coordinates: [...item.geometry.coordinates] }, properties: { ...item.properties } })))
// FeatureCollection 是编辑器唯一的空间状态；legacy 数组仅作为模板/交互兼容投影。
const spatialFeatureCollection = ref(toCampusFeatureCollection({ buildings: buildings.value, roads: roads.value, areas: areas.value, objects: objects.value, metadata: BASE_CAMPUS_FEATURE_COLLECTION.metadata }))
const objectKinds = [{ value: 'tree', label: '树木' }, { value: 'streetlight', label: '路灯' }, { value: 'bench', label: '座椅' }, { value: 'sculpture', label: '雕塑' }]
const objectKind = ref('tree')
const selectedObject = computed(() => objects.value.find(item => item.id === selected.value.id && selected.value.type === 'object') || null)
const selected = ref({ type: 'building', id: buildings.value[0]?.id })
const multiSelection = ref([])
const boxSelection = ref(null)
const selectionCount = computed(() => multiSelection.value.length || (selected.value.id ? 1 : 0))
const selectedBuildingFootprintValidation = computed(() => selectedBuilding.value
  ? validateBuildingFootprint(selectedBuilding.value.footprint)
  : { valid: true, errors: [] })
function toggleMultiSelection(type, id, event) {
  if (!event?.shiftKey) { multiSelection.value = []; selected.value = { type, id }; return false }
  if (!multiSelection.value.length && selected.value.id && !isLayerLocked(selected.value.type)) {
    multiSelection.value.push({ type: selected.value.type, id: selected.value.id })
  }
  const index = multiSelection.value.findIndex(item => item.type === type && item.id === id)
  if (index >= 0) multiSelection.value.splice(index, 1)
  else if (!isLayerLocked(type)) multiSelection.value.push({ type, id })
  selected.value = multiSelection.value.at(-1) || { type: '', id: '' }
  return true
}
function featureCollection(type) { return type === 'building' ? buildings.value : type === 'road' ? roads.value : type === 'object' ? objects.value : areas.value }
function featureGeometry(type, item) {
  return type === 'road' ? item.points.map(point => [...point]) : item.footprint.map(point => [...point])
}
function beginFeatureDrag(event, type, item) {
  if (event.button !== 0 || tool.value !== 'select' || spacePressed.value || isLayerLocked(type)) return
  event.stopPropagation()
  if (event.shiftKey) { toggleMultiSelection(type, item.id, event); return }
  const isMultiDrag = multiSelection.value.length > 1 && multiSelection.value.some(entry => entry.type === type && entry.id === item.id)
  if (!isMultiDrag) { multiSelection.value = []; selected.value = { type, id: item.id } }
  snapshot()
  const start = point(event)
  if (isMultiDrag) {
    const items = multiSelection.value.filter(entry => !isLayerLocked(entry.type)).map(entry => {
      const feature = featureCollection(entry.type).find(candidate => candidate.id === entry.id)
      return feature ? { type: entry.type, id: entry.id, geometry: JSON.parse(JSON.stringify(spatialFeatureCollection.value.features.find(item => String(item.id) === String(entry.id))?.geometry)) } : null
    }).filter(Boolean)
    drag.value = { type: 'multi', start, items }
  } else {
    const canonicalFeature = spatialFeatureCollection.value.features.find(feature => String(feature.id) === String(item.id))
    drag.value = { type, id: item.id, start, geometry: JSON.parse(JSON.stringify(canonicalFeature?.geometry)) }
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
function clearMultiSelection() { multiSelection.value = [] }
function getFeatureBounds(type, feature) {
  const points = type === 'road' ? feature.points : feature.footprint
  if (!points || !points.length) return null
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}
function alignSelection(mode) {
  const targets = multiSelection.value.filter(entry => !isLayerLocked(entry.type)).map(entry => {
    const feature = featureCollection(entry.type).find(item => item.id === entry.id)
    return feature ? { ...entry, feature, bounds: getFeatureBounds(entry.type, feature) } : null
  }).filter(entry => entry && entry.bounds)
  if (targets.length < 2) return
  const left = Math.min(...targets.map(entry => entry.bounds.left))
  const right = Math.max(...targets.map(entry => entry.bounds.right))
  const top = Math.min(...targets.map(entry => entry.bounds.top))
  const bottom = Math.max(...targets.map(entry => entry.bounds.bottom))
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2
  snapshot()
  targets.forEach(entry => {
    const b = entry.bounds
    const dx = mode === 'left' ? left - b.left : mode === 'right' ? right - b.right : mode === 'centerX' ? centerX - (b.left + b.right) / 2 : 0
    const dy = mode === 'top' ? top - b.top : mode === 'bottom' ? bottom - b.bottom : mode === 'centerY' ? centerY - (b.top + b.bottom) / 2 : 0
    const moved = featureGeometry(entry.type, entry.feature).map(point => [point[0] + dx, point[1] + dy])
    const canonical = spatialFeatureCollection.value.features.find(feature => String(feature.id) === String(entry.id))
    if (canonical) commitFeatureGeometryValue(entry.id, translateCampusFeatureGeometry(canonical.geometry, dx, dy))
  })
}
function distributeSelection(axis) {
  const targets = multiSelection.value.filter(entry => !isLayerLocked(entry.type) && layerStates.value[layerKey(entry.type)]?.visible).map(entry => {
    const feature = featureCollection(entry.type).find(item => item.id === entry.id)
    return feature ? { ...entry, feature, bounds: getFeatureBounds(entry.type, feature) } : null
  }).filter(entry => entry && entry.bounds)
  if (targets.length < 3) return
  const startKey = axis === 'horizontal' ? 'left' : 'top'
  const endKey = axis === 'horizontal' ? 'right' : 'bottom'
  const sizeKey = axis === 'horizontal' ? 'width' : 'height'
  targets.sort((a, b) => a.bounds[startKey] - b.bounds[startKey])
  const totalSpan = targets[targets.length - 1].bounds[endKey] - targets[0].bounds[startKey]
  const occupied = targets.reduce((sum, entry) => sum + entry.bounds[sizeKey], 0)
  const gap = (totalSpan - occupied) / (targets.length - 1)
  let cursor = targets[0].bounds[endKey] + gap
  snapshot()
  targets.slice(1).forEach(entry => {
    const delta = cursor - entry.bounds[startKey]
    const dx = axis === 'horizontal' ? delta : 0
    const dy = axis === 'vertical' ? delta : 0
    const moved = featureGeometry(entry.type, entry.feature).map(point => [point[0] + dx, point[1] + dy])
    const canonical = spatialFeatureCollection.value.features.find(feature => String(feature.id) === String(entry.id))
    if (canonical) commitFeatureGeometryValue(entry.id, translateCampusFeatureGeometry(canonical.geometry, dx, dy))
    cursor += entry.bounds[sizeKey] + gap
  })
}
function deleteSelectionBatch() {
  const targets = multiSelection.value.length ? [...multiSelection.value] : (selected.value.id ? [selected.value] : [])
  if (!targets.length) return
  const deletable = targets.filter(item => !isLayerLocked(item.type))
  if (!deletable.length) return
  snapshot()
  const ids = { building: new Set(), road: new Set(), area: new Set(), object: new Set() }
  const deletedBaseIds = deletable.map(item => String(item.id)).filter(id => BASE_CAMPUS_FEATURE_IDS.has(id))
  if (deletedBaseIds.length) deletedFeatureIds.value = [...new Set([...deletedFeatureIds.value, ...deletedBaseIds])]
  deletable.forEach(item => ids[item.type]?.add(item.id))
  commitFeatureRemoval(deletable.map(item => item.id))
  selected.value = { type: '', id: '' }
  multiSelection.value = []
}
// 图层状态仅控制编辑视图与交互，不写入地图业务数据。
const layerStates = ref({ buildings: { visible: true, locked: false }, roads: { visible: true, locked: false }, areas: { visible: true, locked: false }, objects: { visible: true, locked: false } })
const clipboardObject = ref(null)
let duplicateSequence = 0
function copySelected() {
  const targets = multiSelection.value.length > 1 ? multiSelection.value : (selected.value.id ? [selected.value] : [])
  const copied = targets.filter(entry => !isLayerLocked(entry.type)).map(entry => {
    const feature = spatialFeatureCollection.value.features.find(candidate => String(candidate.id) === String(entry.id))
    return feature ? { type: entry.type, feature: JSON.parse(JSON.stringify(feature)) } : null
  }).filter(Boolean)
  if (copied.length) clipboardObject.value = copied
}
function pasteCopied() {
  const copied = Array.isArray(clipboardObject.value) ? clipboardObject.value : (clipboardObject.value ? [clipboardObject.value] : [])
  const available = copied.filter(entry => !isLayerLocked(entry.type))
  if (!available.length) return
  snapshot()
  const pasted = []
  available.forEach(entry => {
    duplicateSequence += 1
    const cloneId = `copy-${entry.type}-${Date.now()}-${duplicateSequence}`
    const clone = duplicateCampusFeature(entry.feature, cloneId, 24, 24)
    commitFeatureCollectionMutation(collection => upsertCampusFeature(collection, clone))
    pasted.push({ type: entry.type, id: clone.id })
  })
  multiSelection.value = pasted
  selected.value = pasted[pasted.length - 1] || { type: '', id: '' }
  tool.value = 'select'
}
function handleEditorKeydown(event) {
  const target = event.target
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); return }
  if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteCopied(); return }
  if ((event.key === 'Delete' || event.key === 'Backspace') && (selected.value.id || multiSelection.value.length)) { event.preventDefault(); deleteSelected() }
  if (event.key === 'Escape') { cancelGeometryDraft(); tool.value = 'select'; clearMultiSelection(); selected.value = { type: '', id: '' } }
}
const tool = ref('select')
const draftPoints = ref([])
const draftPointCount = computed(() => draftPoints.value.length)
function setTool(nextTool) {
  tool.value = nextTool
  draftPoints.value = []
}
function cancelGeometryDraft() { draftPoints.value = [] }
function handleCanvasClick(event) {
  if (suppressCanvasClick.value || calibrationMode.value) return
  if (tool.value === 'building') {
    addBuilding(event)
    return
  }
  if (['building-outline', 'road', 'area'].includes(tool.value)) {
    const p = point(event)
    draftPoints.value.push([p.x, p.y])
    return
  }
  if (tool.value === 'object') addPointObject(event)
}
function finishGeometryDraft() {
  const points = draftPoints.value.map(([x, y]) => [x, y])
  if (tool.value === 'building-outline' || tool.value === 'area') {
    if (points.length < 3) return
  } else if (tool.value === 'road') {
    if (points.length < 2) return
  } else return
  const geometry = createDraftGeometry(tool.value === 'road' ? 'LineString' : 'Polygon', points)
  snapshot()
  const id = `${tool.value}-${Date.now()}`
  if (tool.value === 'road') {
    commitFeatureUpsert({ roads: [{ id, points: geometry.coordinates, width: roadWidth.value, confidence: 'unverified', source: 'manual' }] })
    selected.value = { type: 'road', id }
  } else if (tool.value === 'building-outline') {
    const footprint = geometry.coordinates[0].slice(0, -1)
    commitFeatureUpsert({ buildings: [{ id, label: newBuilding.value, template: newBuilding.value, footprint, rect: polygonBounds(footprint), floors: null, confidence: 'unverified', source: 'manual' }] })
    selected.value = { type: 'building', id }
  } else {
    commitFeatureUpsert({ areas: [{ id, name: areaKinds.find(item => item.value === areaKind.value)?.label || '校园区域', type: areaKind.value, footprint: geometry.coordinates[0].slice(0, -1), confidence: 'unverified', source: 'manual' }] })
    selected.value = { type: 'area', id }
  }
  draftPoints.value = []
  tool.value = 'select'
}
// 区域对象共享面几何，但保留明确的业务类型，供 2.5D/3D 渲染器选择材质。
const areaKind = ref('vegetation')
const areaKinds = [
  { value: 'vegetation', label: '绿地 / 草坪' },
  { value: 'water', label: '湖泊 / 水体' },
  { value: 'sports', label: '操场 / 运动场' },
  { value: 'plaza', label: '广场 / 铺装' },
  { value: 'parking', label: '停车场' },
]
const scale = ref(1)
const pan = ref({ x: 0, y: 0 })
// 视口尺寸使用真实 CSS 像素，SVG 世界坐标随视口宽高比动态计算，避免固定 640×480 导致画布挤压。
const canvasViewport = ref(null)
const viewportSize = ref({ width: 640, height: 480 })
let canvasResizeObserver = null
let canvasViewInitialized = false
const canvasPan = ref(null)
const spacePressed = ref(false)
const suppressCanvasClick = ref(false)
const showGrid = ref(false)
const drag = ref(null)
const history = ref([])
const future = ref([])
const roadWidth = ref(10)
const snapEnabled = ref(true)
const snapTolerance = 7
const newBuilding = ref('教学楼')
const referenceImage = ref(null)
const referenceImagePreview = ref('')
const referenceImageOpacity = ref(0.55)
const calibrationMode = ref(false)
const calibrationPoints = ref([])
const targetX = ref(0)
const targetY = ref(0)
const calibrationError = ref('')
const recognitionBusy = ref(false)
const recognitionMessage = ref('')
const recognitionStage = ref('idle')
const recognitionElapsed = ref(0)
let recognitionTimer = null
const generateSceneAssets = ref(true)
const calibrationTransform = computed(() => {
  try {
    calibrationError.value = ''
    return calibrationPoints.value.length >= 2 ? fitCampusSimilarityTransform(calibrationPoints.value) : null
  } catch (error) {
    calibrationError.value = error.message
    return null
  }
})
async function uploadReferenceImage(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { calibrationError.value = '请选择 PNG、JPG 或 WebP 图片'; return }
  if (file.size > 15 * 1024 * 1024) { calibrationError.value = '底图不能超过 15 MB'; return }
  if (!props.campusId || !props.mapId) { calibrationError.value = '当前地图未连接服务端，无法上传持久化底图'; return }
  persistenceBusy.value = true
  try {
    const body = new FormData()
    body.append('file', file)
    const asset = await apiRequest(`${mapApiPath()}/assets/base-map`, { method: 'POST', body })
    const preview = await apiRequest(`${mapApiPath()}/assets/${asset.id}/content`, { raw: true })
    if (referenceImagePreview.value.startsWith('blob:')) URL.revokeObjectURL(referenceImagePreview.value)
    referenceImagePreview.value = URL.createObjectURL(preview)
    const image = new Image()
    image.onload = () => {
      referenceImage.value = {
        assetId: String(asset.id), name: asset.original_name || file.name,
        width: image.naturalWidth, height: image.naturalHeight, uri: asset.contentPath,
        coordinateSpace: 'image-pixel', status: 'unverified',
      }
      calibrationPoints.value = []
      calibrationError.value = ''
      persistenceMessage.value = '底图已上传，正在自动保存并启动 AI 识图。'
      void recognizeReferenceImage(String(asset.id))
    }
    image.onerror = () => { calibrationError.value = '服务端底图读取成功，但图片解码失败' }
    image.src = referenceImagePreview.value
    savedAssetId.value = String(asset.id)
  } catch (error) {
    calibrationError.value = error.message
  } finally {
    persistenceBusy.value = false
    event.target.value = ''
  }
}

async function recognizeReferenceImage(assetId = savedAssetId.value) {
  if (!assetId || recognitionBusy.value) return
  recognitionBusy.value = true
  recognitionStage.value = 'queued'
  recognitionElapsed.value = 0
  recognitionMessage.value = '正在提交识图任务…'
  recognitionTimer = window.setInterval(() => { recognitionElapsed.value += 1 }, 1000)
  try {
    const job = await apiRequest(`${mapApiPath()}/assets/${assetId}/recognize`, { method: 'POST' })
    let result = null
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise(resolve => window.setTimeout(resolve, 2000))
      const status = await apiRequest(`${mapApiPath()}/assets/recognition/${job.id}`)
      if (status.status === 'completed') { recognitionStage.value = 'completed'; result = status; break }
      if (status.status === 'failed') throw new Error(status.error_message || '视觉模型识图失败')
      recognitionStage.value = status.status === 'processing' ? 'processing' : 'queued'
      recognitionMessage.value = status.status === 'processing'
        ? `模型正在识别建筑、道路及公共空间…（已用时 ${recognitionElapsed.value} 秒）`
        : `任务已进入后台队列，等待工作进程处理…（已等待 ${recognitionElapsed.value} 秒）`
    }
    if (!result) throw new Error('识图任务等待超时；任务仍保留在服务端，可稍后重新查询')
    const features = result.features || []
    if (!features.length) {
      recognitionMessage.value = '识图已完成，但没有提取到可用空间要素；请检查图片清晰度。'
      return
    }
    snapshot()
    let added = 0
    const toEditorPoint = ([x, y]) => [Number(x) * 640 / referenceImage.value.width, Number(y) * 480 / referenceImage.value.height]
    for (const feature of features) {
      if (feature.geometry.type === 'Polygon') {
        const ring = (feature.geometry.coordinates?.[0] || []).map(toEditorPoint)
        if (ring.length < 4) continue
        if (feature.type === 'building') {
          commitFeatureUpsert({ buildings: [{
            id: `ai-building-${job.id}-${added}`, label: feature.name || '识别建筑',
            template: generateSceneAssets.value ? '教学楼' : '识别建筑',
            rect: polygonBounds(ring), footprint: ring, floors: null,
            confidence: feature.confidence, source: 'ai-vision', reviewRequired: feature.reviewRequired,
            materialHint: feature.properties?.materialHint || null,
          }] })
        } else {
          commitFeatureUpsert({ areas: [{
            id: `ai-area-${job.id}-${added}`, name: feature.name || feature.type,
            type: feature.type === 'green' ? 'vegetation' : feature.type,
            footprint: ring, confidence: feature.confidence,
            source: 'ai-vision', reviewRequired: feature.reviewRequired,
          }] })
        }
        added++
      } else if (feature.geometry.type === 'LineString' && feature.type === 'road') {
        const points = feature.geometry.coordinates.map(toEditorPoint)
        if (points.length >= 2) {
          commitFeatureUpsert({ roads: [{
            id: `ai-road-${job.id}-${added}`, points,
            width: Math.max(4, Number(feature.properties?.width) || 10),
            confidence: feature.confidence, source: 'ai-vision', reviewRequired: feature.reviewRequired,
          }] })
          added++
        }
      }
    }
    recognitionMessage.value = `AI 识别完成：新增 ${added} 个矢量要素，${features.filter(item => item.reviewRequired).length} 个低置信度结果需要人工复核。请检查轮廓后再作为正式地图使用。${generateSceneAssets.value ? ' 已为建筑分配内置像素风建筑模板。' : ' 未启用场景素材模板。'}`
    if (added) {
      const first = buildings.value.find(item => item.source === 'ai-vision')
      if (first) selected.value = { type: 'building', id: first.id }
    }
  } catch (error) {
    recognitionStage.value = 'failed'
    recognitionMessage.value = `AI 识图失败：${error.message}`
  } finally {
    if (recognitionTimer) window.clearInterval(recognitionTimer)
    recognitionTimer = null
    recognitionBusy.value = false
    if (recognitionStage.value !== 'completed' && recognitionStage.value !== 'failed') recognitionStage.value = 'idle'
  }
}

function captureCalibrationPoint(event) {
  if (!calibrationMode.value || !referenceImagePreview.value) return
  event.stopPropagation()
  const source = point(event)
  calibrationPoints.value.push({ source: [source.x * referenceImage.value.width / 640, source.y * referenceImage.value.height / 480], target: [Number(targetX.value), Number(targetY.value)] })
}
function removeCalibrationPoint(index) { calibrationPoints.value.splice(index, 1) }
function clearReferenceImage() {
  if (referenceImagePreview.value.startsWith('blob:')) URL.revokeObjectURL(referenceImagePreview.value)
  referenceImage.value = null
  referenceImagePreview.value = ''
  calibrationPoints.value = []
  calibrationMode.value = false
}

const roadNetwork = computed(() => roadNetworkToMultiPolygon(roads.value))
const workspaceBounds = computed(() => calculateWorkspaceBounds({ buildings: buildings.value, areas: areas.value, roads: roads.value }))
// 可视化范围由“当前视口 + 已有要素范围”共同决定；视口移动到原始校园图外时，网格和底色继续延伸。
const canvasRenderBounds = computed(() => {
  const viewportWidth = viewportSize.value.width / scale.value
  const viewportHeight = viewportSize.value.height / scale.value
  const margin = Math.max(500, viewportWidth * 0.5, viewportHeight * 0.5)
  const visible = {
    minX: pan.value.x - margin,
    minY: pan.value.y - margin,
    maxX: pan.value.x + viewportWidth + margin,
    maxY: pan.value.y + viewportHeight + margin,
  }
  const minX = Math.min(workspaceBounds.value.minX, visible.minX)
  const minY = Math.min(workspaceBounds.value.minY, visible.minY)
  const maxX = Math.max(workspaceBounds.value.maxX, visible.maxX)
  const maxY = Math.max(workspaceBounds.value.maxY, visible.maxY)
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
})
const selectedBuilding = computed(() => buildings.value.find((item) => item.id === selected.value.id))
const selectedRoad = computed(() => roads.value.find((item) => item.id === selected.value.id))
const selectedArea = computed(() => areas.value.find((item) => item.id === selected.value.id))
const selectedLabel = computed(() => selectedBuilding.value?.label || selectedRoad.value?.id || selectedArea.value?.name || selectedObject.value?.name || '未选择对象')
const layerItems = computed(() => [
  { key: 'buildings', label: '建筑图层', count: buildings.value.length, icon: '▦' },
  { key: 'roads', label: '道路图层', count: roads.value.length, icon: '⌁' },
  { key: 'areas', label: '区域图层', count: areas.value.length, icon: '▧' },
  { key: 'objects', label: '树木与设施', count: objects.value.length, icon: '♧' },
])
function layerKey(type) { return type === 'building' ? 'buildings' : type === 'road' ? 'roads' : type === 'object' ? 'objects' : 'areas' }
function isLayerLocked(type) { return Boolean(layerStates.value[layerKey(type)]?.locked) }
function toggleLayerVisibility(key) {
  layerStates.value[key].visible = !layerStates.value[key].visible
  if (!layerStates.value[key].visible && selected.value.type && layerKey(selected.value.type) === key) {
    selected.value = { type: '', id: '' }
    drag.value = null
  }
}
function toggleLayerLock(key) {
  layerStates.value[key].locked = !layerStates.value[key].locked
  if (layerStates.value[key].locked && selected.value.type && layerKey(selected.value.type) === key) {
    selected.value = { type: '', id: '' }
    drag.value = null
  }
}
const palette = CAMPUS_BUILDING_ASSET_CATALOG.map(item => item.template)
const buildingPreset = item => CAMPUS_BUILDING_TEMPLATES[item?.template] || CAMPUS_BUILDING_TEMPLATES['教学楼']
const buildingWallColor = item => ({ wall: '#e7d2a5', wallCream: '#e7d2a5', wallPeach: '#d8a77d', wallMint: '#b8c99a' }[buildingPreset(item).wall] || '#e7d2a5')
const areaColor = (type) => ({ water: '#6bb8b4', sports: '#b9b69f', vegetation: '#78936d', plaza: '#b8b2a0', parking: '#858b8d' }[type] || '#78936d')
const polygonPath = (multiPolygon) => multiPolygon.flatMap((polygon) => polygon.map((ring) => 'M ' + ring.map((point) => point.join(' ')).join(' L ') + ' Z')).join(' ')
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
function serializeSpatialHistory() {
  // 撤销/重做历史以规范 FeatureCollection 为唯一空间快照，不再分别保存四组 legacy 数组。
  return JSON.stringify(createCampusFeatureSnapshot(buildDocument()))
}
function snapshot() {
  history.value.push(serializeSpatialHistory())
  if (history.value.length > 40) history.value.shift()
  future.value = []
}
function restore(raw) {
  const state = JSON.parse(raw)
  if (state?.type === 'CampusFeatureSnapshot') {
    const document = restoreCampusFeatureSnapshot(state)
    buildings.value = document.buildings
    roads.value = document.roads
    areas.value = document.areas
    objects.value = document.objects
    // 历史快照携带完整规范集合；直接恢复可保留当前兼容视图尚不支持的 Feature 类型。
    spatialFeatureCollection.value = document.featureCollection
    deletedFeatureIds.value = spatialFeatureCollection.value.deletedFeatureIds
    return
  }
  // 兼容当前会话中旧版历史快照，避免热更新/历史恢复时丢失数据。
  buildings.value = state.buildings || []
  roads.value = state.roads || []
  areas.value = state.areas || []
  objects.value = state.objects || []
  deletedFeatureIds.value = state.deletedFeatureIds || []
  spatialFeatureCollection.value = toCampusFeatureCollection({ buildings: buildings.value, roads: roads.value, areas: areas.value, objects: objects.value, deletedFeatureIds: deletedFeatureIds.value })
}
function undo() {
  if (!history.value.length) return
  future.value.push(serializeSpatialHistory())
  restore(history.value.pop())
}
function redo() {
  if (!future.value.length) return
  history.value.push(serializeSpatialHistory())
  restore(future.value.pop())
}
function canvasViewBox() {
  return [pan.value.x, pan.value.y, viewportSize.value.width / scale.value, viewportSize.value.height / scale.value].join(' ')
}
function startCanvasPan(event) {
  // 平移事件绑定在视口容器，而不是 SVG；这样即使指针离开 SVG 内容区域，仍可持续拖动画布。
  if (event.button === 2 || (event.button !== 0 && event.button !== 1)) return
  const onFeature = Boolean(event.target.closest?.('.map-feature'))
  if (event.button === 0 && onFeature && tool.value !== 'pan' && !spacePressed.value) return
  if (event.button === 0 && tool.value !== 'pan' && !spacePressed.value) return
  canvasPan.value = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    x: pan.value.x,
    y: pan.value.y,
    moved: false,
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}
function moveCanvasPan(event) {
  if (!canvasPan.value) return
  const state = canvasPan.value
  const dx = event.clientX - state.clientX, dy = event.clientY - state.clientY
  if (Math.hypot(dx, dy) > 3) state.moved = true
  pan.value = { x: state.x - dx / scale.value, y: state.y - dy / scale.value }
  suppressCanvasClick.value = state.moved
}
function endCanvasPan() {
  if (!canvasPan.value) return
  canvasPan.value = null
  if (suppressCanvasClick.value) window.setTimeout(() => { suppressCanvasClick.value = false }, 0)
}
function zoomAt(next, clientX, clientY) {
  const svg = document.querySelector('.campus-map')
  if (!svg) { scale.value = next; return }
  const cursor = svg.createSVGPoint()
  const rect = svg.getBoundingClientRect()
  cursor.x = clientX ?? rect.left + rect.width / 2
  cursor.y = clientY ?? rect.top + rect.height / 2
  const anchor = cursor.matrixTransform(svg.getScreenCTM().inverse())
  const oldWidth = viewportSize.value.width / scale.value
  const oldHeight = viewportSize.value.height / scale.value
  const rx = (anchor.x - pan.value.x) / oldWidth
  const ry = (anchor.y - pan.value.y) / oldHeight
  scale.value = next
  pan.value = { x: anchor.x - rx * viewportSize.value.width / next, y: anchor.y - ry * viewportSize.value.height / next }
}
function zoomCanvas(event) {
  const next = Math.min(8, Math.max(0.05, scale.value * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))
  zoomAt(next, event.clientX, event.clientY)
}
function resetCanvasView() {
  const bounds = workspaceBounds.value
  scale.value = Math.min(8, Math.max(0.05, Math.min(viewportSize.value.width / (bounds.width * 1.12), viewportSize.value.height / (bounds.height * 1.12))))
  pan.value = { x: (bounds.minX + bounds.maxX) / 2 - viewportSize.value.width / (2 * scale.value), y: (bounds.minY + bounds.maxY) / 2 - viewportSize.value.height / (2 * scale.value) }
}
function zoomToSelection() {
  const item = selectedBuilding.value || selectedArea.value
  const road = selectedRoad.value
  let bounds = item ? polygonBounds(item.footprint) : null
  if (road?.points?.length) {
    const xs = road.points.map(point => point[0]), ys = road.points.map(point => point[1])
    bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  if (!bounds) return
  const width = Math.max(bounds[2] - bounds[0], 24), height = Math.max(bounds[3] - bounds[1], 24)
  const next = Math.min(8, Math.max(0.05, Math.min(viewportSize.value.width / (width * 2.2), viewportSize.value.height / (height * 2.2))))
  scale.value = next
  pan.value = { x: (bounds[0] + bounds[2]) / 2 - viewportSize.value.width / (2 * next), y: (bounds[1] + bounds[3]) / 2 - viewportSize.value.height / (2 * next) }
}
function onWindowKeyDown(event) {
  if (event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return
  if (event.code === 'Space') { spacePressed.value = true; event.preventDefault() }
  if (event.key === '+' || event.key === '=') zoomAt(Math.min(8, scale.value * 1.12))
  if (event.key === '-') zoomAt(Math.max(0.05, scale.value / 1.12))
  if (event.key === '0') resetCanvasView()
  if ((event.key === 'Delete' || event.key === 'Backspace') && selected.value.id) deleteSelected()
}
function onWindowKeyUp(event) { if (event.code === 'Space') spacePressed.value = false }
function preventCanvasContextMenu(event) { event.preventDefault() }
onMounted(() => {
  window.addEventListener('keydown', handleEditorKeydown)
  window.addEventListener('keydown', onWindowKeyDown)
  loadEditorDocument()
  window.addEventListener('keyup', onWindowKeyUp)
  if (canvasViewport.value && typeof ResizeObserver !== 'undefined') {
    canvasResizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.max(1, entry.contentRect.width)
      const height = Math.max(1, entry.contentRect.height)
      const previous = viewportSize.value
      if (canvasViewInitialized) {
        // 面板尺寸变化时保持当前世界坐标中心不变，不重置用户的浏览位置。
        const centerX = pan.value.x + previous.width / (2 * scale.value)
        const centerY = pan.value.y + previous.height / (2 * scale.value)
        viewportSize.value = { width, height }
        pan.value = { x: centerX - width / (2 * scale.value), y: centerY - height / (2 * scale.value) }
      } else {
        viewportSize.value = { width, height }
        canvasViewInitialized = true
        resetCanvasView()
      }
    })
    canvasResizeObserver.observe(canvasViewport.value)
  } else {
    canvasViewInitialized = true
    resetCanvasView()
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEditorKeydown)
  window.removeEventListener('keydown', onWindowKeyDown)
  canvasResizeObserver?.disconnect()
  // 路由切换/关闭编辑器时，若 debounce 尚未触发且当前没有保存请求，
  // 立即启动最后一次保存，避免清理定时器时丢弃已编辑内容。
  if (autoSaveTimer) {
    window.clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  if (documentLoaded.value && !persistenceBusy.value && !revisionConflict.value &&
      JSON.stringify(buildDocument()) !== lastSavedSnapshot) {
    void saveEditorDocument()
  }
  if (referenceImagePreview.value.startsWith('blob:')) URL.revokeObjectURL(referenceImagePreview.value)
  window.removeEventListener('keyup', onWindowKeyUp)
})
watch(() => JSON.stringify(buildDocument()), (snapshot) => {
  if (!documentLoaded.value || !props.campusId || !props.mapId || revisionConflict.value) return
  if (snapshot === lastSavedSnapshot) return
  persistenceState.value = 'dirty'
  persistenceMessage.value = '检测到未保存修改，等待自动保存…'
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer)
  autoSaveTimer = window.setTimeout(() => {
    if (persistenceBusy.value) {
      autoSaveTimer = window.setTimeout(() => saveEditorDocument(), 500)
      return
    }
    saveEditorDocument()
  }, 1500)
})
function point(event) {
  const svg = event.currentTarget.ownerSVGElement || event.currentTarget
  const p = svg.createSVGPoint()
  p.x = event.clientX; p.y = event.clientY
  const local = p.matrixTransform(svg.getScreenCTM().inverse())
  return { x: local.x, y: local.y }
}
function startBoxSelection(event) {
  if (event.button !== 0 || tool.value !== 'select' || spacePressed.value || calibrationMode.value || event.target.closest?.('.map-feature')) return
  const start = point(event)
  boxSelection.value = { start, current: start, pointerId: event.pointerId }
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
}
function updateBoxSelection(event) {
  if (!boxSelection.value) return
  boxSelection.value.current = point(event)
}
function pointInsideRect(point, rect) { return point[0] >= rect.left && point[0] <= rect.right && point[1] >= rect.top && point[1] <= rect.bottom }
function pointInsidePolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j]
    const crosses = (yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || 0.0000001) + xi
    if (crosses) inside = !inside
  }
  return inside
}
function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const ab1 = cross(a, b, c), ab2 = cross(a, b, d), cd1 = cross(c, d, a), cd2 = cross(c, d, b)
  const overlaps = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
  return overlaps && ab1 * ab2 <= 0 && cd1 * cd2 <= 0
}
function featureMatchesBox(type, feature, rect, contain) {
  const points = type === 'road' ? feature.points : feature.footprint
  if (!points?.length) return false
  if (contain) return points.every(point => pointInsideRect(point, rect))
  if (points.some(point => pointInsideRect(point, rect))) return true
  const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]
  const edgeCount = type === 'road' ? points.length - 1 : points.length
  for (let i = 0; i < edgeCount; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const edges = [[[rect.left, rect.top], [rect.right, rect.top]], [[rect.right, rect.top], [rect.right, rect.bottom]], [[rect.right, rect.bottom], [rect.left, rect.bottom]], [[rect.left, rect.bottom], [rect.left, rect.top]]]
    if (edges.some(([c, d]) => segmentsIntersect(a, b, c, d))) return true
  }
  return type !== 'road' && corners.some(corner => pointInsidePolygon(corner, points))
}
function finishBoxSelection() {
  if (!boxSelection.value) return
  const { start, current } = boxSelection.value
  boxSelection.value = null
  const dx = current.x - start.x, dy = current.y - start.y
  if (Math.hypot(dx, dy) < 4) { multiSelection.value = []; selected.value = { type: '', id: '' }; return }
  const rect = { left: Math.min(start.x, current.x), right: Math.max(start.x, current.x), top: Math.min(start.y, current.y), bottom: Math.max(start.y, current.y) }
  const contain = dx >= 0
  const hits = []
  ;[['building', buildings.value], ['road', roads.value], ['area', areas.value]].forEach(([type, collection]) => {
    if (isLayerLocked(type) || !layerStates.value[layerKey(type)]?.visible) return
    collection.forEach(feature => {
      if (featureMatchesBox(type, feature, rect, contain)) hits.push({ type, id: feature.id })
    })
  })
  multiSelection.value = hits
  selected.value = hits[hits.length - 1] || { type: '', id: '' }
}
function startBuildingDrag(event, item) { beginFeatureDrag(event, 'building', item) }
function startAreaDrag(event, area) { beginFeatureDrag(event, 'area', area) }
function startObjectDrag(event, item) {
  if (event.button !== 0 || tool.value !== 'select' || spacePressed.value || isLayerLocked('object')) return
  event.stopPropagation()
  selected.value = { type: 'object', id: item.id }
  multiSelection.value = []
  snapshot()
  drag.value = { type: 'object', id: item.id, start: point(event), position: [...item.geometry.coordinates] }
  // 点对象的拖动由 SVG 根节点统一接收 pointermove，避免捕获在 <g> 后事件链不稳定。
  event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId)
}
function startPolygonVertexDrag(event, type, item, index) {
  if (event.button !== 0 || tool.value === 'pan' || spacePressed.value || isLayerLocked(type)) return
  event.stopPropagation()
  selected.value = { type, id: item.id }
  snapshot()
  drag.value = { type: 'vertex', featureType: type, id: item.id, index }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
function selectRoad(event, road) { beginFeatureDrag(event, 'road', road) }
function startRoadNodeDrag(event, road, index) {
  if (event.button !== 0 || tool.value === 'pan' || spacePressed.value || isLayerLocked('road')) return
  event.stopPropagation()
  if (toggleMultiSelection('road', road.id, event)) return
  snapshot()
  drag.value = { type: 'node', id: road.id, index }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
function movePointer(event) {
  if (boxSelection.value) { updateBoxSelection(event); return }
  if (!drag.value) return
  const p = point(event)
  const currentDrag = drag.value
  if (currentDrag.type === 'multi') {
    const updates = currentDrag.items.map(entry => {
      const dx = p.x - currentDrag.start.x, dy = p.y - currentDrag.start.y
      return { id: entry.id, geometry: translateCampusFeatureGeometry(entry.geometry, dx, dy) }
    }).filter(entry => entry.geometry)
    commitFeatureCollectionMutation(collection => updates.reduce(
      (next, entry) => updateCampusFeatureGeometry(next, entry.id, entry.geometry),
      collection,
    ))
  } else if (currentDrag.type === 'vertex') {
    const collection = currentDrag.featureType === 'building' ? buildings.value : areas.value
    const item = collection.find(entry => entry.id === currentDrag.id)
    if (item) {
      const candidate = snapEnabled.value ? snapPoint(p, currentDrag.index) : p
      const canonical = spatialFeatureCollection.value.features.find(feature => String(feature.id) === String(currentDrag.id))
      if (canonical?.geometry?.type === 'Polygon') {
        const geometry = {
          ...canonical.geometry,
          coordinates: canonical.geometry.coordinates.map((ring, ringIndex) => ringIndex === 0
            ? ring.map((point, index) => index === currentDrag.index ? [candidate.x, candidate.y] : point)
            : ring),
        }
        commitFeatureGeometryValue(currentDrag.id, geometry)
      }
    }
  } else if (currentDrag.type === 'building') {
    const item = buildings.value.find(entry => entry.id === currentDrag.id)
    if (item) commitFeatureGeometryValue(item.id, translateCampusFeatureGeometry(currentDrag.geometry, p.x - currentDrag.start.x, p.y - currentDrag.start.y))
  } else if (currentDrag.type === 'object') {
    const item = objects.value.find(entry => entry.id === currentDrag.id)
    if (item) commitFeatureGeometryValue(item.id, { type: 'Point', coordinates: [currentDrag.position[0] + p.x - currentDrag.start.x, currentDrag.position[1] + p.y - currentDrag.start.y] })
  } else if (currentDrag.type === 'area') {
    const item = areas.value.find(entry => entry.id === currentDrag.id)
    if (item) commitFeatureGeometryValue(item.id, translateCampusFeatureGeometry(currentDrag.geometry, p.x - currentDrag.start.x, p.y - currentDrag.start.y))
  } else if (currentDrag.type === 'road') {
    const item = roads.value.find(entry => entry.id === currentDrag.id)
    if (item) commitFeatureGeometryValue(item.id, translateCampusFeatureGeometry(currentDrag.geometry, p.x - currentDrag.start.x, p.y - currentDrag.start.y))
  } else if (currentDrag.type === 'node') {
    const item = roads.value.find(entry => entry.id === currentDrag.id)
    if (item) {
      const canonical = spatialFeatureCollection.value.features.find(feature => String(feature.id) === String(item.id))
      if (canonical?.geometry?.type === 'LineString') {
        const coordinates = canonical.geometry.coordinates.map((point, index) => index === currentDrag.index ? [p.x, p.y] : point)
        commitFeatureGeometryValue(item.id, { ...canonical.geometry, coordinates })
      }
    }
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
  const footprint = ring.map(point => [...point])
  footprint.splice(bestIndex + 1, 0, [(a[0]+b[0])/2, (a[1]+b[1])/2])
  commitPolygonOuterRing(item.id, footprint)
}
function removePolygonVertex(index) {
  const item = selectedBuilding.value || selectedArea.value
  if (!item || item.footprint.length <= 3) return
  snapshot()
  const footprint = item.footprint.filter((_, vertexIndex) => vertexIndex !== index).map(point => [...point])
  commitPolygonOuterRing(item.id, footprint)
}
function endPointer() { if (boxSelection.value) finishBoxSelection(); drag.value = null }
function addBuilding(event) {
  snapshot()
  const position = event?.clientX != null ? point(event) : { x: 305, y: 232 }
  const id = `placed-building-${Date.now()}`
  const rect = [position.x - 25, position.y - 12, position.x + 25, position.y + 12]
  commitFeatureUpsert({ buildings: [{ id, label: newBuilding.value, template: newBuilding.value, rect, footprint: rectToPolygon(rect), floors: null, confidence: 'unverified' }] })
  selected.value = { type: 'building', id }
  tool.value = 'select'
}
function addPointObject(event) {
  snapshot()
  const p = event?.clientX != null ? point(event) : { x: 320, y: 250 }
  const id = `${objectKind.value}-${Date.now()}`
  commitFeatureUpsert({ objects: [{ id, type: objectKind.value, name: objectKinds.find(entry => entry.value === objectKind.value)?.label || '校园设施', geometry: { type: 'Point', coordinates: [p.x, p.y] }, properties: { rotation: 0, scale: 1 }, source: 'manual', qualityStatus: 'unverified' }] })
  selected.value = { type: 'object', id }; tool.value = 'select'
}
function addArea(event) {
  snapshot()
  const position = event?.clientX != null ? point(event) : { x: 320, y: 250 }
  const id = `area-${areaKind.value}-${Date.now()}`
  const size = areaKind.value === 'water' ? { width: 70, height: 44 } : { width: 52, height: 34 }
  const footprint = rectToPolygon([position.x - size.width / 2, position.y - size.height / 2, position.x + size.width / 2, position.y + size.height / 2])
  commitFeatureUpsert({ areas: [{ id, name: areaKinds.find(item => item.value === areaKind.value)?.label || '校园区域', type: areaKind.value, footprint, confidence: 'unverified', source: 'manual' }] })
  selected.value = { type: 'area', id }
  tool.value = 'select'
}
function addRoad(event) {
  snapshot()
  const position = event?.clientX != null ? point(event) : { x: 300, y: 265 }
  const id = `road-custom-${Date.now()}`
  commitFeatureUpsert({ roads: [{ id, confidence: 'unverified', points: [[position.x - 45, position.y],[position.x, position.y + 8],[position.x + 45, position.y]], width: roadWidth.value }] })
  selected.value = { type: 'road', id }
  tool.value = 'select'
}
function updateBuildingMetric(metric, rawValue) {
  const item = selectedBuilding.value
  const value = Number(rawValue)
  if (!item || !Number.isFinite(value)) return
  const oldBounds = polygonBounds(item.footprint)
  const oldWidth = Math.max(0.0001, oldBounds[2] - oldBounds[0])
  const oldHeight = Math.max(0.0001, oldBounds[3] - oldBounds[1])
  const nextBounds = [...oldBounds]
  if (metric === 'x') nextBounds[0] = value
  if (metric === 'y') nextBounds[1] = value
  if (metric === 'width') nextBounds[2] = nextBounds[0] + Math.max(4, value)
  if (metric === 'height') nextBounds[3] = nextBounds[1] + Math.max(4, value)
  if (metric === 'x') nextBounds[2] = value + oldWidth
  if (metric === 'y') nextBounds[3] = value + oldHeight
  if (nextBounds.every((coordinate, index) => coordinate === oldBounds[index])) return
  snapshot()
  const nextWidth = nextBounds[2] - nextBounds[0], nextHeight = nextBounds[3] - nextBounds[1]
  const footprint = item.footprint.map(([x, y]) => [
    nextBounds[0] + ((x - oldBounds[0]) / oldWidth) * nextWidth,
    nextBounds[1] + ((y - oldBounds[1]) / oldHeight) * nextHeight,
  ])
  commitPolygonOuterRing(item.id, footprint)
}
function rotateBuilding() {
  const item = selectedBuilding.value
  if (!item) return
  snapshot()
  commitPolygonOuterRing(item.id, rotatePolygon(item.footprint, 90))
}
function addRoadNode() {
  const road = selectedRoad.value
  if (!road || road.points.length < 2) return
  snapshot()
  let index = 0, longest = -Infinity
  for (let i = 0; i < road.points.length - 1; i++) { const a = road.points[i], b = road.points[i+1]; const length = Math.hypot(b[0]-a[0], b[1]-a[1]); if (length > longest) { longest = length; index = i } }
  const a = road.points[index], b = road.points[index+1]
  const points = road.points.map(point => [...point])
  points.splice(index+1, 0, [(a[0]+b[0])/2, (a[1]+b[1])/2])
  commitFeatureGeometryValue(road.id, { type: 'LineString', coordinates: points })
}
function removeRoadNode(index) {
  const road = selectedRoad.value
  if (!road || road.points.length <= 2) return
  snapshot()
  const points = road.points.filter((_, pointIndex) => pointIndex !== index).map(point => [...point])
  commitFeatureGeometryValue(road.id, { type: 'LineString', coordinates: points })
}
function deleteSelected() {
  if (multiSelection.value.length > 1) { deleteSelectionBatch(); return }
  if (!selected.value.id || isLayerLocked(selected.value.type)) return
  snapshot()
  if (BASE_CAMPUS_FEATURE_IDS.has(String(selected.value.id))) {
    deletedFeatureIds.value = [...new Set([...deletedFeatureIds.value, String(selected.value.id)])]
  }
  commitFeatureRemoval([selected.value.id])
  selected.value = { type: '', id: '' }
}
function commitFeatureCollectionMutation(mutator) {
  // 所有空间写入都以规范 FeatureCollection 为输入和输出；数组只用于兼容现有模板。
  const next = mutator(spatialFeatureCollection.value)
  spatialFeatureCollection.value = next
  const document = fromCampusFeatureCollection(next)
  buildings.value = document.buildings.map(normalizeBuilding)
  roads.value = document.roads
  areas.value = document.areas
  objects.value = document.objects
  deletedFeatureIds.value = document.deletedFeatureIds
}
function commitFeatureUpsert(fragment) {
  const incoming = toCampusFeatureCollection(fragment)
  commitFeatureCollectionMutation(collection => incoming.features.reduce(
    (next, feature) => upsertCampusFeature(next, feature),
    collection,
  ))
}
function commitFeatureGeometryValue(featureId, geometry) {
  commitFeatureCollectionMutation(collection => updateCampusFeatureGeometry(collection, featureId, geometry))
}
function commitPolygonOuterRing(featureId, footprint) {
  const fragment = toCampusFeatureCollection({ areas: [{ id: featureId, footprint }] })
  const outerRing = fragment.features[0]?.geometry?.coordinates?.[0]
  if (!outerRing) throw new Error('无法生成 Polygon 外环')
  commitFeatureCollectionMutation(collection => {
    const current = collection.features.find(item => String(item.id) === String(featureId))
    if (current?.geometry?.type !== 'Polygon') throw new Error('目标 Feature 不是 Polygon')
    return updateCampusFeatureGeometry(collection, featureId, {
      type: 'Polygon',
      coordinates: [outerRing, ...current.geometry.coordinates.slice(1)],
    })
  })
}
function commitFeatureRemoval(featureIds) {
  const ids = featureIds.map(String)
  commitFeatureCollectionMutation(collection => removeCampusFeatures(collection, ids, { recordDeleted: ids.some(id => BASE_CAMPUS_FEATURE_IDS.has(id)) }))
}
function updateSelectedFeatureProperty(key, value, { numeric = false, nested = false } = {}) {
  const featureId = selected.value.id
  if (!featureId) return
  const normalizedValue = numeric && value !== '' ? Number(value) : value
  commitFeatureCollectionMutation(collection => {
    const feature = collection.features.find(item => String(item.id) === String(featureId))
    if (!feature) return collection
    const patch = nested === 'objectProperties'
      ? { [key]: normalizedValue }
      : { [key]: normalizedValue }
    return updateCampusFeatureProperties(collection, featureId, patch)
  })
}

function buildDocument() {
  // 保存、历史、预览均从唯一空间状态派生；legacy 数组不再反向生成空间数据。
  const projected = fromCampusFeatureCollection(spatialFeatureCollection.value)
  return {
    schemaVersion: 4,
    deletedFeatureIds: [...spatialFeatureCollection.value.deletedFeatureIds],
    coordinateSystem: 'campus-plan-pixel',
    units: 'pixel',
    worldUnitsPerCampusUnit: 1,
    source: 'campusLayout.js',
    referenceImage: referenceImage.value ? { ...referenceImage.value, opacity: referenceImageOpacity.value } : null,
    calibration: calibrationTransform.value ? { ...calibrationTransform.value, controlPoints: calibrationPoints.value } : null,
    workspaceBounds: workspaceBounds.value,
    areas: projected.areas.map(({ polygon, rect, ...area }) => ({ ...area, polygon: area.footprint })),
    buildings: projected.buildings.map(normalizeBuilding),
    roads: projected.roads,
    objects: projected.objects,
    featureCollection: spatialFeatureCollection.value,
  }
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
        <button title="缩小（-）" @click="zoomAt(Math.max(.05, scale / 1.12))">−</button><span class="zoom-value">{{ Math.round(scale*100) }}%</span><button @click="resetCanvasView">适配工作区</button><button title="放大（+）" @click="zoomAt(Math.min(8, scale * 1.12))">＋</button><button @click="zoomToSelection" :disabled="!selected.id">定位选中</button>
        <button @click="preview3d">三维预览</button><span class="save-indicator" :class="persistenceState" :title="persistenceMessage">{{ persistenceBusy ? '正在保存…' : persistenceState === 'saved' ? `已保存 · v${documentRevision}` : persistenceState === 'dirty' ? '有未保存修改' : persistenceState === 'conflict' ? '保存冲突' : persistenceState === 'error' ? '保存失败' : '等待修改' }}</span><button @click="saveEditorDocument" :disabled="persistenceBusy || revisionConflict || !documentLoaded">立即保存</button><button @click="exportDocument">导出场景</button><button @click="emit('close')">退出编辑</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="tool-panel">
        <div class="sidebar-overview"><div class="sidebar-kicker">WORKSPACE</div><strong>场景构建</strong><span>从资产库开始搭建校园地图</span><div class="sidebar-stats"><div><b>{{ buildings.length }}</b><small>建筑</small></div><div><b>{{ roads.length }}</b><small>道路</small></div><div><b>{{ areas.length }}</b><small>区域</small></div></div></div>
        <div class="panel-title">编辑工具</div>
        <div class="tool-grid">
          <button :class="{active:tool==='select'}" @click="setTool('select')"><span>↖</span>选择移动</button>
          <button :class="{active:tool==='building'}" @click="setTool('building')"><span>▰</span>建筑摆放</button>
          <button :class="{active:tool==='building-outline'}" @click="setTool('building-outline')"><span>⬡</span>建筑轮廓</button>
          <button :class="{active:tool==='road'}" @click="setTool('road')"><span>⌁</span>道路绘制</button>
          <button :class="{active:tool==='area'}" @click="setTool('area')"><span>▧</span>区域绘制</button>
          <button :class="{active:tool==='object'}" @click="setTool('object')"><span>♧</span>点对象放置</button>
          <label>设施类型<select v-model="objectKind"><option v-for="item in objectKinds" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
          <label class="area-kind-select">区域类型<select v-model="areaKind"><option v-for="item in areaKinds" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        </div>
        <div class="panel-separator"></div>
        <section class="layer-panel">
          <div class="panel-title">图层管理 <small>LAYERS</small></div>
          <div v-for="layer in layerItems" :key="layer.key" class="layer-row" :class="{ locked: layerStates[layer.key].locked, hidden: !layerStates[layer.key].visible }">
            <span class="layer-icon">{{ layer.icon }}</span>
            <span class="layer-name"><b>{{ layer.label }}</b><small>{{ layer.count }} 个对象</small></span>
            <button class="layer-action" :title="layerStates[layer.key].visible ? '隐藏图层' : '显示图层'" @click="toggleLayerVisibility(layer.key)">{{ layerStates[layer.key].visible ? '◉' : '○' }}</button>
            <button class="layer-action" :title="layerStates[layer.key].locked ? '解锁图层' : '锁定图层'" @click="toggleLayerLock(layer.key)">{{ layerStates[layer.key].locked ? '▣' : '▢' }}</button>
          </div>
          <small class="layer-help">隐藏仅影响画布显示；锁定后禁止选择、拖动、顶点编辑和删除。</small>
        </section>
        <div class="panel-separator"></div>
        <div class="panel-title">底图与校准</div>
        <label class="upload-control">上传校园底图（PNG/JPG/WebP，≤15MB）<input type="file" accept="image/png,image/jpeg,image/webp" @change="uploadReferenceImage" /></label>
        <template v-if="referenceImage">
          <small class="hint">{{ referenceImage.name }} · {{ referenceImage.width }} × {{ referenceImage.height }}</small>
          <div class="recognition-notice"><strong>AI 空间要素识别</strong><span>上传后自动分析图片，识别建筑、道路、绿地、水体和运动场。结果先作为待复核矢量图层，不会覆盖正式 GIS 数据。</span></div>
          <label class="upload-control"><input type="checkbox" v-model="generateSceneAssets" /> 同时生成场景素材（建筑使用内置像素风模板）</label>
          <button class="add-button" :disabled="recognitionBusy" @click="recognizeReferenceImage()">{{ recognitionBusy ? 'AI 识图中…' : '重新执行 AI 识图' }}</button>
          <div v-if="recognitionBusy" class="recognition-progress" role="status" aria-live="polite">
            <div class="recognition-progress-head"><b>{{ recognitionStage === 'processing' ? '正在识别' : '排队等待' }}</b><span>{{ recognitionElapsed }}s</span></div>
            <div class="recognition-progress-track"><i :class="{ active: recognitionStage === 'processing' }"></i></div>
            <small>{{ recognitionMessage }}</small>
            <small class="recognition-progress-tip">AI 识图耗时取决于图片复杂度和视觉模型响应，当前显示真实任务阶段，不虚报完成百分比。</small>
          </div>
          <small v-else class="hint">{{ recognitionMessage }}</small>
          <label>底图透明度 <b>{{ Math.round(referenceImageOpacity * 100) }}%</b></label>
          <input v-model.number="referenceImageOpacity" type="range" min="0" max="1" step="0.05" />
          <label class="upload-control"><input type="checkbox" v-model="calibrationMode" /> 开始控制点选取</label>
          <div class="coordinate-grid"><label>目标 X<input v-model.number="targetX" type="number" /></label><label>目标 Y<input v-model.number="targetY" type="number" /></label></div>
          <small class="hint">点击地图添加控制点；至少两个点生成相似变换。</small>
          <div v-for="(item,index) in calibrationPoints" :key="index" class="calibration-row">P{{ index+1 }} · {{ item.target.join(', ') }} <button @click="removeCalibrationPoint(index)">移除</button></div>
          <small v-if="calibrationTransform" class="hint">比例 {{ calibrationTransform.scale.toFixed(5) }} · 旋转 {{ calibrationTransform.rotationDegrees.toFixed(2) }}° · RMS {{ calibrationTransform.rmsError.toFixed(3) }}</small>
          <button class="add-button" @click="clearReferenceImage">移除底图</button>
        </template>
        <small v-if="calibrationError" class="hint">{{ calibrationError }}</small>
        <small v-if="persistenceMessage" class="hint">{{ persistenceMessage }}</small>
        <button v-if="revisionConflict" class="danger-button" @click="exportDocument">导出本地版本</button>
        <button v-if="revisionConflict" class="add-button" @click="reloadEditorDocument">重新加载服务端版本</button>
        <div class="panel-title asset-title">建筑资产库 <small>{{ palette.length }} 种</small></div>
        <div class="asset-grid">
          <button v-for="item in palette" :key="item" :class="{selected:newBuilding===item}" @click="newBuilding=item;setTool('building')"><span class="asset-glyph">▦</span><b>{{ item }}</b><small>点击放置</small></button>
        </div>
        <div class="panel-title road-title">道路工具</div>
        <label>道路宽度 <b>{{ roadWidth }} px</b></label><input v-model.number="roadWidth" type="range" min="4" max="24">
        <button class="add-button" @click="setTool('road')">＋ 新建道路</button>
        <p class="hint">建筑资产库选择后，使用“建筑摆放”可单击地图直接放置默认矩形建筑，再拖动移动或编辑顶点；需要自定义轮廓时选择“建筑轮廓”，至少绘制 3 个顶点并点击“完成绘制”。道路至少 2 点，区域至少 3 点。Esc 取消当前绘制。快捷键：拖动空白区域框选（左→右完全包含，右→左相交即选中）；Shift + 点击多选；Ctrl/Cmd + C 复制，Ctrl/Cmd + V 粘贴（支持多对象），Delete 批量删除，Esc 清空选择。复制对象后会在右下方偏移 24 像素生成副本。</p><p class="hint">拖动建筑调整位置；选择道路后拖动控制点调整走向。当前底图来自已有校园空间标注，非测绘数据。</p>
      </aside>
      <main class="map-stage">
        <div class="stage-label"><div><span class="live-dot"></span> CAMPUS / TOP-DOWN VIEW <em>二维编辑视口</em></div><span class="stage-coordinates">{{ Math.round(scale * 100) }}% 缩放 · {{ selectedLabel }}</span></div>
        <div class="canvas-toolbar"><div class="canvas-tool-group"><button :class="{active:tool==='select'}" @click="tool='select'" title="选择工具">↖ 选择</button><button :class="{active:tool==='pan'}" @click="tool='pan'" title="按住并拖动以平移画布">✋ 平移</button><button :class="{active:tool==='building'}" @click="tool='building'" title="建筑工具">▰ 建筑</button><button :class="{active:tool==='road'}" @click="tool='road'" title="道路工具">⌁ 道路</button><button :class="{active:tool==='area'}" @click="tool='area'" title="区域工具">▧ 区域</button><button :class="{active:tool==='object'}" @click="tool='object'" title="点对象工具">♧ 设施</button></div><div class="canvas-tool-group"><span class="selection-count">{{ selectionCount }} 已选</span><span v-if="['building-outline','road','area'].includes(tool)" class="selection-count">绘制中 {{ draftPointCount }} 点</span><button v-if="['building-outline','road','area'].includes(tool)" @click="finishGeometryDraft" :disabled="draftPointCount < (tool==='road' ? 2 : 3)">完成绘制</button><button v-if="draftPointCount" @click="cancelGeometryDraft">取消绘制</button><button @click="copySelected" :disabled="!selected.id && !multiSelection.length">复制</button><button @click="pasteCopied" :disabled="!clipboardObject || !(Array.isArray(clipboardObject) ? clipboardObject.some(entry => !isLayerLocked(entry.type)) : !isLayerLocked(clipboardObject.type))">粘贴</button><button @click="deleteSelected" :disabled="!selected.id && !multiSelection.length">批量删除</button><button @click="alignSelection('left')" :disabled="multiSelection.length<2" title="左对齐">左对齐</button><button @click="alignSelection('centerX')" :disabled="multiSelection.length<2" title="水平居中">水平居中</button><button @click="alignSelection('top')" :disabled="multiSelection.length<2" title="顶部对齐">顶对齐</button><button @click="alignSelection('centerY')" :disabled="multiSelection.length<2" title="垂直居中">垂直居中</button><button @click="alignSelection('right')" :disabled="multiSelection.length<2" title="右对齐">右对齐</button><button @click="alignSelection('bottom')" :disabled="multiSelection.length<2" title="底部对齐">底对齐</button><button @click="distributeSelection('horizontal')" :disabled="multiSelection.length<3" title="水平等间距">水平分布</button><button @click="distributeSelection('vertical')" :disabled="multiSelection.length<3" title="垂直等间距">垂直分布</button><button @click="undo" :disabled="!history.length">↶</button><button @click="redo" :disabled="!future.length">↷</button><button @click="showGrid=!showGrid">{{ showGrid ? '隐藏网格' : '显示网格' }}</button><button @click="resetCanvasView">适配画布</button></div></div>
        <div ref="canvasViewport" class="map-scroll" :class="{ 'pan-mode': tool === 'pan' || spacePressed }" @pointerdown="startCanvasPan" @pointermove="moveCanvasPan" @pointerup="endCanvasPan" @pointercancel="endCanvasPan">
          <svg class="campus-map" :viewBox="canvasViewBox()" @pointerdown="startBoxSelection" @click.capture="captureCalibrationPoint" @wheel.prevent="zoomCanvas" @pointermove="movePointer($event)" @pointerup="endPointer()" @pointercancel="endPointer()" @contextmenu="preventCanvasContextMenu" @click="handleCanvasClick($event)">
            <defs>
              <pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#4c654d" stroke-opacity=".14" stroke-width=".7"/></pattern>
              <pattern id="grass-pattern" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M4 6l2 -2 M17 18l2 -2 M10 14l1 -2" stroke="#64894f" stroke-width="1.4" opacity=".48"/><rect x="19" y="4" width="2" height="2" fill="#c1cf83" opacity=".5"/></pattern><pattern id="path-pattern" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M3 4h3 M11 13h4" stroke="#e1c89d" stroke-width="2" opacity=".65"/></pattern>
            </defs>
            <rect :x="canvasRenderBounds.minX" :y="canvasRenderBounds.minY" :width="canvasRenderBounds.width" :height="canvasRenderBounds.height" fill="#86a765"/><rect v-if="boxSelection" :x="Math.min(boxSelection.start.x,boxSelection.current.x)" :y="Math.min(boxSelection.start.y,boxSelection.current.y)" :width="Math.abs(boxSelection.current.x-boxSelection.start.x)" :height="Math.abs(boxSelection.current.y-boxSelection.start.y)" fill="#4f86bd" fill-opacity=".14" stroke="#3678b8" stroke-width="1.5" stroke-dasharray="5 3" pointer-events="none"/><g v-for="(item,index) in calibrationPoints" :key="`calibration-${index}`" pointer-events="none"><circle :cx="item.source[0]" :cy="item.source[1]" r="7" fill="#e6a84c" stroke="#fff" stroke-width="2"/><text :x="item.source[0]+9" :y="item.source[1]-8" fill="#263b2d" font-size="12">P{{ index+1 }}</text></g><rect :x="canvasRenderBounds.minX" :y="canvasRenderBounds.minY" :width="canvasRenderBounds.width" :height="canvasRenderBounds.height" fill="url(#grass-pattern)" opacity=".42"/><image v-if="referenceImagePreview" :href="referenceImagePreview" x="0" y="0" width="640" height="480" preserveAspectRatio="none" :opacity="referenceImageOpacity" pointer-events="none"/>
            <g v-if="layerStates.areas.visible" v-for="area in areas" :key="area.id" class="map-feature" @pointerdown="startAreaDrag($event, area)">
              <polygon :points="area.footprint.map(p=>p.join(',')).join(' ')" :fill="areaColor(area.type)" :stroke="selected.id===area.id || multiSelection.some(entry=>entry.type==='area' && entry.id===area.id) ? '#e6a84c' : '#d7e5d3'" :stroke-width="selected.id===area.id ? 4 : 2" opacity=".72"/>
              <g v-if="selected.type==='area' && selected.id===area.id"><circle v-for="(vertex,index) in area.footprint" :key="index" :cx="vertex[0]" :cy="vertex[1]" r="5" fill="#f5c36b" stroke="#3d513f" stroke-width="1.5" @pointerdown="startPolygonVertexDrag($event,'area',area,index)" @dblclick.stop="removePolygonVertex(index)"/></g>
            </g>
            <g v-if="layerStates.objects.visible" v-for="item in objects" :key="item.id" class="map-feature" @pointerdown="startObjectDrag($event,item)"><circle :cx="item.geometry.coordinates[0]" :cy="item.geometry.coordinates[1]" :r="selected.id===item.id ? 10 : 7" :fill="item.type==='tree' ? '#4f8050' : item.type==='streetlight' ? '#d5b56b' : item.type==='bench' ? '#9b7955' : '#8c7b9e'" :stroke="selected.id===item.id ? '#e6a84c' : '#f4f1e6'" stroke-width="2"/><text :x="item.geometry.coordinates[0]+10" :y="item.geometry.coordinates[1]+4" font-size="8" fill="#344b3b">{{ item.name }}</text></g>
             <g v-if="draftPoints.length"><polyline v-if="tool==='road'" :points="draftPoints.map(p=>p.join(',')).join(' ')" fill="none" stroke="#e6a84c" :stroke-width="Math.max(3,roadWidth)" stroke-opacity=".55" stroke-linecap="round" stroke-linejoin="round"/><polygon v-else :points="draftPoints.map(p=>p.join(',')).join(' ')" fill="#e6a84c" fill-opacity=".18" stroke="#d18b35" stroke-width="2" stroke-dasharray="5 3"/><circle v-for="(p,index) in draftPoints" :key="`draft-${index}`" :cx="p[0]" :cy="p[1]" r="4" fill="#f4c36b" stroke="#744f24" stroke-width="1.5"/></g><g v-if="showGrid"><rect :x="canvasRenderBounds.minX" :y="canvasRenderBounds.minY" :width="canvasRenderBounds.width" :height="canvasRenderBounds.height" fill="url(#map-grid)"/></g>
            <path v-if="layerStates.roads.visible" :d="polygonPath(roadNetwork)" fill="#c3a477" stroke="#8f7655" stroke-width="1.5" fill-rule="evenodd" stroke-linejoin="round"/><path v-if="layerStates.roads.visible" :d="polygonPath(roadNetwork)" fill="url(#path-pattern)" stroke="none" fill-rule="evenodd" pointer-events="none"/>
            <g v-if="layerStates.roads.visible" v-for="road in roads" :key="road.id" class="map-feature" @pointerdown="selectRoad($event,road)">
              <path :d="roadPath(road.points)" fill="none" stroke="transparent" :stroke-width="Math.max(road.width || 13, 18)" />
              <path v-if="selected.id===road.id || multiSelection.some(entry=>entry.type==='road' && entry.id===road.id)" :d="roadPath(road.points)" fill="none" stroke="#d59a43" :stroke-width="Math.max(2,(road.width || 13)*0.18)" stroke-linecap="round" pointer-events="none"/>
              <g v-if="selected.id===road.id"><circle v-for="(node,index) in road.points" :key="index" :cx="node[0]" :cy="node[1]" r="5" fill="#f0bc61" stroke="#3c4a3d" stroke-width="2" @pointerdown="startRoadNodeDrag($event,road,index)" @dblclick.stop="removeRoadNode(index)"/></g>
            </g>
            <g v-if="layerStates.buildings.visible" v-for="item in buildings" :key="item.id" class="building map-feature" @pointerdown="startBuildingDrag($event,item)">
              <polygon :points="item.footprint.map(p=>p.join(',')).join(' ')" fill="#c8a66e" fill-opacity=".42" stroke="#806b4b" stroke-width="2"/>
              <polygon :points="item.footprint.map(p=>p.join(',')).join(' ')" fill="none" stroke="#f0e5ce" stroke-width="1" stroke-dasharray="3 3"/>
              <text :x="(item.rect[0]+item.rect[2])/2" :y="(item.rect[1]+item.rect[3])/2+3" text-anchor="middle" font-size="8" fill="#514634">{{ item.label }}</text>
              <polygon v-if="selected.id===item.id" :points="item.footprint.map(p=>p.join(',')).join(' ')" fill="none" stroke="#e6a84c" stroke-width="2" stroke-dasharray="5 3"/>
              <g v-if="selected.type==='building' && selected.id===item.id"><circle v-for="(vertex,index) in item.footprint" :key="index" :cx="vertex[0]" :cy="vertex[1]" r="5" fill="#f5c36b" stroke="#3d513f" stroke-width="1.5" @pointerdown="startPolygonVertexDrag($event,'building',item,index)" @dblclick.stop="removePolygonVertex(index)"/></g>
            </g>
            
            <g fill="#435844" font-size="10" font-weight="700"><text x="260" y="178">中心湖区</text><text x="548" y="105">运动场</text><text x="75" y="386">运动场</text></g>
          </svg>
        </div>
        <footer class="stage-footer"><span>工作区 {{ workspaceBounds.width }} × {{ workspaceBounds.height }} · 底图为参考图层，工作区可无限平移 · 空白处拖动 / 空格+拖动 / 中键拖动 / 滚轮缩放</span><span>对象 {{ buildings.length }} 栋建筑 · {{ roads.length }} 条道路 · {{ areas.length }} 个区域</span><span>坐标：可超出原图范围的编辑单位</span></footer>
      </main>
      <aside class="inspector">
        <div class="inspector-heading"><div class="panel-title">属性检查器</div><span>PROPERTIES</span></div>
        <div class="selected-card"><small>当前选中</small><strong>{{ selectedLabel }}</strong><span>{{ selected.type==='road' ? '道路 / LineString' : selected.type==='building' ? '建筑 / Footprint' : selected.type==='area' ? '校园区域 / Polygon' : '请选择场景对象' }}</span></div>
        <template v-if="selectedBuilding">
          <label>建筑名称</label><input  :value="selectedBuilding.label" @focus="snapshot" @change="updateSelectedFeatureProperty('name',$event.target.value)">
          <label>建筑模板</label><select  :value="selectedBuilding.template" @focus="snapshot" @change="updateSelectedFeatureProperty('template',$event.target.value)"><option v-for="item in palette" :key="item" :value="item">{{ item }}</option></select>
          <label>三维建筑参数</label>
          <div class="property-grid">
            <label>建筑高度<input type="number" min="1" max="80" step="0.2"  :value="selectedBuilding.height" @focus="snapshot" @change="updateSelectedFeatureProperty('height',$event.target.value,{numeric:true})"></label>
            <label>楼层数<input type="number" min="1" max="30" step="1"  :value="selectedBuilding.floors" @focus="snapshot" @change="updateSelectedFeatureProperty('floors',$event.target.value,{numeric:true})"></label>
            <label>窗户密度<input type="number" min="0.1" max="3" step="0.05"  :value="selectedBuilding.windowDensity" @focus="snapshot" @change="updateSelectedFeatureProperty('windowDensity',$event.target.value,{numeric:true})"></label>
            <label>窗户宽度<input type="number" min="0.2" max="3" step="0.05"  :value="selectedBuilding.windowWidth" @focus="snapshot" @change="updateSelectedFeatureProperty('windowWidth',$event.target.value,{numeric:true})"></label>
            <label>窗户高度<input type="number" min="0.2" max="3" step="0.05"  :value="selectedBuilding.windowHeight" @focus="snapshot" @change="updateSelectedFeatureProperty('windowHeight',$event.target.value,{numeric:true})"></label>
            <label>入口宽度<input type="number" min="0.5" max="5" step="0.1"  :value="selectedBuilding.doorWidth" @focus="snapshot" @change="updateSelectedFeatureProperty('doorWidth',$event.target.value,{numeric:true})"></label>
            <label>屋顶起拱高度<input type="number" min="0" max="8" step="0.1"  :value="selectedBuilding.roofRise" @focus="snapshot" @change="updateSelectedFeatureProperty('roofRise',$event.target.value,{numeric:true})"></label>
          </div>
          <label>屋顶样式</label><select  :value="selectedBuilding.roofStyle" @focus="snapshot" @change="updateSelectedFeatureProperty('roofStyle',$event.target.value)"><option value="">跟随建筑模板</option><option value="flat">平顶</option><option value="pitched">双坡顶</option><option value="glass">玻璃顶</option><option value="span">跨度双坡顶（受限轮廓）</option></select>
          <label>主入口所在边</label><select  :value="selectedBuilding.entranceEdgeIndex" @focus="snapshot" @change="updateSelectedFeatureProperty('entranceEdgeIndex',$event.target.value === '' ? null : Number($event.target.value),{numeric:false})"><option value="">自动选择最长边</option><option v-for="(_,index) in selectedBuilding.footprint" :key="index" :value="index">第 {{ index + 1 }} 条边</option></select>
          <div v-if="!selectedBuildingFootprintValidation.valid" class="geometry-warning">
            <strong>建筑轮廓校验未通过</strong><span v-for="error in selectedBuildingFootprintValidation.errors" :key="error">{{ error }}</span>
          </div>
          <small class="hint property-hint">参数应用于三维预览；入口边可手动指定。留空时使用最长边作为主入口。</small>
          <label>位置与尺寸（地图像素）</label>
          <div class="property-grid">
            <label>X 位置<input type="number" :value="Math.round(selectedBuilding.rect[0])" @change="updateBuildingMetric('x',$event.target.value)"></label>
            <label>Y 位置<input type="number" :value="Math.round(selectedBuilding.rect[1])" @change="updateBuildingMetric('y',$event.target.value)"></label>
            <label>宽度<input type="number" min="4" :value="Math.round(selectedBuilding.rect[2]-selectedBuilding.rect[0])" @change="updateBuildingMetric('width',$event.target.value)"></label>
            <label>高度<input type="number" min="4" :value="Math.round(selectedBuilding.rect[3]-selectedBuilding.rect[1])" @change="updateBuildingMetric('height',$event.target.value)"></label>
          </div>
          <small class="hint property-hint">输入数值后按 Enter 或离开输入框即可更新轮廓；支持撤销与自动保存。</small>
          <label>数据可信度</label><span class="confidence">{{ selectedBuilding.confidence || 'unverified' }}</span>
          <button class="add-button" @click="addPolygonVertex">＋ 添加最长边顶点</button><p class="hint">拖动黄色顶点编辑轮廓；点击顶点删除（至少保留 3 个）。</p><button class="add-button" @click="rotateBuilding">↻ 旋转 90°</button><button class="danger-button" @click="deleteSelected">删除建筑</button>
        </template>
        <template v-else-if="selectedArea">
          <label>区域名称</label><input  :value="selectedArea.name" @focus="snapshot" @change="updateSelectedFeatureProperty('name',$event.target.value)">
          <label>区域类型</label><select  :value="selectedArea.type" @focus="snapshot" @change="updateSelectedFeatureProperty('areaType',$event.target.value)"><option v-for="item in areaKinds" :key="item.value" :value="item.value">{{ item.label }}</option></select>
          <button class="add-button" @click="addPolygonVertex">＋ 添加最长边顶点</button><p class="hint">拖动黄色顶点编辑轮廓；点击顶点删除（至少保留 3 个）。支持顶点吸附。</p>
          <button class="danger-button" @click="deleteSelected">删除区域</button>
        </template>
        <template v-else-if="selectedObject">
          <label>对象名称</label><input  :value="selectedObject.name" @focus="snapshot" @change="updateSelectedFeatureProperty('name',$event.target.value)">
          <label>对象类型</label><select  :value="selectedObject.type" @focus="snapshot" @change="updateSelectedFeatureProperty('objectType',$event.target.value)"><option v-for="item in objectKinds" :key="item.value" :value="item.value">{{ item.label }}</option></select>
          <label>朝向（度）</label><input type="number"  :value="selectedObject.properties.rotation" @focus="snapshot" @change="updateSelectedFeatureProperty('rotation',$event.target.value,{numeric:true,nested:'objectProperties'})">
          <label>缩放</label><input type="number" min="0.2" max="5" step="0.1"  :value="selectedObject.properties.scale" @focus="snapshot" @change="updateSelectedFeatureProperty('scale',$event.target.value,{numeric:true})">
          <button class="danger-button" @click="deleteSelected">删除对象</button>
        </template>
        <template v-else-if="selectedRoad">
          <label>道路宽度</label><input type="range"  :value="selectedRoad.width" @focus="snapshot" @change="updateSelectedFeatureProperty('width',$event.target.value,{numeric:true})" min="4" max="24">
          <button class="add-button" @click="addRoadNode">＋ 添加道路控制点</button><p class="hint">拖动控制点调整曲线；点击控制点删除（至少保留 2 个）。道路采用平滑曲线显示。</p><button class="danger-button" @click="deleteSelected">删除道路</button>
        </template>
        <div v-else class="empty-inspector"><span class="empty-inspector-icon">⌖</span><strong>尚未选择对象</strong><p>在画布中点击建筑、道路或区域，即可查看并编辑对应属性。</p></div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.upload-control{display:block;padding:9px;margin:8px 0;background:#e8eddf;border:1px dashed #87977c;border-radius:6px;cursor:pointer}.upload-control input{display:block;width:100%;margin-top:6px;font-size:11px}.coordinate-grid button{grid-column:span 2}.map-stage svg{user-select:none}
.campus-editor{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;background:#e6dfc9;color:#3b4c37;font-family:Inter,"Microsoft YaHei",sans-serif}.editor-header{height:64px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 22px;background:#f8f7ef;border-bottom:1px solid #c9cbbb}.brand,.header-actions{display:flex;align-items:center;gap:12px}.brand-mark{display:grid;place-items:center;width:36px;height:36px;background:#315b43;color:#f4e8c9;font-weight:800}.brand strong,.brand small{display:block}.brand strong{font-size:14px}.brand small{font-size:9px;letter-spacing:1.4px;color:#788477;margin-top:4px}.header-actions button,.tool-panel button,.inspector button{border:1px solid #c9cbbb;background:#fffdf5;color:#344b3b;border-radius:3px;padding:8px 11px;font-size:12px;cursor:pointer}.header-actions button:disabled{opacity:.4}.header-actions .primary,.add-button{background:#315b43!important;color:#fff!important;border-color:#315b43!important}.zoom-value{font-size:11px;min-width:36px;text-align:center}.save-indicator{font-size:11px;color:#71816d;white-space:nowrap}.save-indicator.saving{color:#a07835}.save-indicator.error,.save-indicator.conflict{color:#a44e3d}.recognition-progress{margin:8px 0;padding:10px;background:#f8f4e9;border:1px solid #dfd2b4;border-radius:5px}.recognition-progress-head{display:flex;justify-content:space-between;font-size:11px;color:#6d5734}.recognition-progress-track{height:6px;margin:8px 0;background:#e7dfcf;border-radius:8px;overflow:hidden}.recognition-progress-track i{display:block;width:32%;height:100%;background:#b77b42;border-radius:8px;animation:recognition-slide 1.35s ease-in-out infinite alternate}.recognition-progress-track i.active{width:48%;background:#71945c}@keyframes recognition-slide{from{transform:translateX(0)}to{transform:translateX(205%)}}.recognition-progress small{display:block;font-size:10px;line-height:1.55;color:#786c56}.recognition-progress-tip{margin-top:4px;opacity:.8}.recognition-notice{padding:9px;background:#f0ead8;border:1px solid #ded2b4;border-radius:4px;margin:10px 0}.recognition-notice strong,.recognition-notice span{display:block}.recognition-notice strong{font-size:11px;color:#6e5b35}.recognition-notice span{font-size:10px;line-height:1.6;color:#81775f;margin-top:4px}.workspace{display:grid;grid-template-columns:190px minmax(0,1fr) 220px;min-height:0;flex:1}.tool-panel,.inspector{background:#f7f6ed;padding:17px 14px;border-right:1px solid #d1d2c5;overflow:auto}.inspector{border-right:0;border-left:1px solid #d1d2c5}.panel-title{font-size:11px;font-weight:800;letter-spacing:1px;color:#607363;margin:2px 0 13px}.tool-panel>button{width:100%;text-align:left;margin-bottom:7px}.tool-panel>button span{display:inline-block;width:23px;font-size:17px}.tool-panel>button.active{background:#e4eadc;border-color:#66866b}.panel-separator{height:1px;background:#d8d9cc;margin:17px 0}.tool-panel select,.inspector input:not([type=range]){width:100%;box-sizing:border-box;border:1px solid #c9cbbb;padding:8px;background:white;margin:7px 0 10px;color:#344b3b}.tool-panel label,.inspector label{display:block;font-size:11px;color:#69766a;margin:14px 0 5px}.tool-panel label b{float:right}.tool-panel input[type=range],.inspector input[type=range]{width:100%;accent-color:#527b58}.road-title{margin-top:22px}.hint{font-size:10px;line-height:1.7;color:#7b867a;margin-top:20px}.map-stage{display:flex;flex-direction:column;min-width:0;background:#d9dfc7}.stage-label{height:38px;display:flex;align-items:center;gap:8px;padding:0 16px;font-size:10px;font-weight:800;letter-spacing:1.1px;color:#4f6653}.stage-label em{font-style:normal;font-weight:400;letter-spacing:0;color:#899184}.live-dot{width:7px;height:7px;border-radius:50%;background:#72965c}.map-scroll{flex:1;min-height:0;overflow:hidden;position:relative;padding:0;touch-action:none;user-select:none;background-color:#d9dfc7;background-image:radial-gradient(#87987955 .7px,transparent .7px);background-size:16px 16px}.campus-map{display:block;width:100%;height:100%;background:#86a765;box-shadow:0 12px 35px #384a3528;touch-action:none;cursor:grab}.campus-map:active{cursor:grabbing}.building{cursor:move}.building:hover rect:first-child{stroke:#d69c43}.stage-footer{height:32px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:9px;color:#738071;background:#e8e9df}.selected-card{padding:12px;background:#e9eddf;border:1px solid #d1d9c8;margin-bottom:16px}.selected-card small,.selected-card strong,.selected-card span{display:block}.selected-card small{font-size:9px;color:#87917e}.selected-card strong{font-size:13px;margin:6px 0}.selected-card span{font-size:10px;color:#6e7d6e}.coordinate-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.coordinate-grid span{padding:7px;background:#eceee5;font-size:10px}.confidence{font-size:10px;color:#9a7542}.inspector .add-button,.inspector .danger-button{width:100%;margin-top:14px}.danger-button{border-color:#d8b7a9!important;color:#9b4d37!important;background:#fff8f4!important}.empty-inspector{font-size:11px;line-height:1.8;color:#879184;padding:20px 0}@media(max-width:900px){.workspace{grid-template-columns:150px minmax(0,1fr)}.inspector{display:none}.editor-header{padding:0 10px}.header-actions{gap:4px}.header-actions button{padding:7px}.brand small{display:none}}@media(max-width:600px){.workspace{grid-template-columns:112px minmax(0,1fr)}.tool-panel{padding:10px 7px}.tool-panel>button{font-size:10px;padding:7px 5px}.stage-footer span:last-child{display:none}.header-actions button:nth-child(3){display:none}}

/* Workbench refresh: clearer hierarchy and directly discoverable editing actions */
.campus-editor{background:#e9e8df;color:#293b30}
.editor-header{height:68px;padding:0 24px;background:#fbfbf7;border-bottom:1px solid #d8ddd3;box-shadow:0 2px 10px #293b3008}
.brand-mark{width:38px;height:38px;border-radius:8px;background:#254f3b}
.header-actions{gap:7px}.header-actions button{border-radius:6px;padding:8px 12px;font-weight:600}
.workspace{grid-template-columns:248px minmax(0,1fr) 284px;background:#e9e8df}
.tool-panel,.inspector{padding:18px 16px;background:#fbfbf7;border-color:#dce1d8}
.sidebar-overview{padding:15px;margin:-2px -2px 20px;background:#eef2e9;border:1px solid #e0e7dc;border-radius:9px}
.sidebar-kicker{font-size:9px;letter-spacing:1.6px;font-weight:800;color:#83917f}
.sidebar-overview>strong{display:block;margin-top:7px;font-size:18px;color:#294632}
.sidebar-overview>span{display:block;margin-top:5px;font-size:10px;color:#7b887a}
.sidebar-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:14px}
.sidebar-stats>div{padding:8px 5px;text-align:center;background:#fff;border:1px solid #e4e9e0;border-radius:6px}
.sidebar-stats b,.sidebar-stats small{display:block}.sidebar-stats b{font-size:16px;color:#315b43}.sidebar-stats small{margin-top:3px;font-size:9px;color:#879184}
.panel-title{display:flex;align-items:center;justify-content:space-between;margin:5px 0 11px;color:#435d49;font-size:11px}
.tool-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.tool-grid button{min-height:60px!important;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:5px;padding:9px!important;border-radius:7px!important;font-weight:600}
.tool-grid button span{font-size:18px;width:auto!important;color:#56745a}
.tool-grid button.active{background:#e8f0e6!important;border-color:#729477!important;color:#28533a!important;box-shadow:inset 0 0 0 1px #729477}
.asset-title small{font-size:9px;font-weight:500;color:#8b9587}
.asset-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.asset-grid button{min-height:78px!important;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;padding:9px!important;border-radius:7px!important;background:#fff!important}
.asset-grid button.selected{border-color:#719276!important;background:#edf3e9!important}
.asset-glyph{display:grid;place-items:center;width:25px;height:25px;border-radius:6px;background:#e8eee4;color:#436b4d;font-size:17px}
.asset-grid b{font-size:10px}.asset-grid small{font-size:9px;color:#899286}
.map-stage{background:#e7ebdf}
.stage-label{height:42px;justify-content:space-between;padding:0 18px;background:#f8faf5;border-bottom:1px solid #dce3d7;color:#49624d}
.stage-label>div{display:flex;align-items:center;gap:8px}.stage-coordinates{font-size:10px;color:#879285;font-weight:500;letter-spacing:0}
.canvas-toolbar{height:46px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:#fff;border-bottom:1px solid #e0e5dc}
.canvas-tool-group{display:flex;align-items:center;gap:5px}
.canvas-toolbar button{padding:6px 10px;border:1px solid #e1e6dd;border-radius:5px;background:#fff;color:#506653;font-size:10px;cursor:pointer}
.canvas-toolbar button.active{background:#e9f1e7;border-color:#88a28a;color:#315b43;font-weight:700}
.canvas-toolbar button:disabled{opacity:.35;cursor:not-allowed}
.map-scroll{background-color:#e7ebdf;background-image:radial-gradient(#7b927755 .8px,transparent .8px);background-size:18px 18px;cursor:crosshair}.map-scroll.pan-mode{cursor:grab}.map-scroll.pan-mode:active{cursor:grabbing}
.campus-map{box-shadow:0 8px 28px #344a351c}
.stage-footer{height:34px;background:#f8faf5;border-top:1px solid #dce3d7;font-size:9px}
.inspector-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.inspector-heading .panel-title{margin:0}.inspector-heading>span{font-size:8px;letter-spacing:1.2px;color:#a0aa9c}
.selected-card{border-radius:8px;background:#eef3ea;border-color:#e0e8dc;padding:14px}
.selected-card strong{color:#2e4e37;font-size:14px}
.selection-count{font-size:10px;color:#637b67;white-space:nowrap}.layer-panel{margin:0 0 4px}.layer-panel>.panel-title{margin-bottom:9px}.layer-panel>.panel-title small{font-size:8px;color:#a0aa9c;letter-spacing:1px}.layer-row{display:flex;align-items:center;gap:6px;padding:8px 6px;margin:5px 0;background:#fff;border:1px solid #e3e8df;border-radius:6px}.layer-row.hidden{opacity:.58;background:#f1f2ed}.layer-row.locked{border-color:#d8c7a8;background:#fbf7ed}.layer-icon{display:grid;place-items:center;width:25px;height:25px;border-radius:5px;background:#edf2e9;color:#48694d}.layer-name{flex:1;min-width:0}.layer-name b,.layer-name small{display:block}.layer-name b{font-size:10px;color:#425845}.layer-name small{margin-top:3px;font-size:9px;color:#8a9587}.layer-action{width:25px;height:25px;padding:0!important;border-radius:4px!important;font-size:13px!important}.layer-help{display:block;font-size:9px;line-height:1.6;color:#879184;margin:8px 2px 0}.property-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.property-grid label{margin:4px 0 0;font-size:10px}.property-grid input{margin-top:5px!important;padding:7px!important;font-variant-numeric:tabular-nums}.property-hint{display:block;margin-top:8px}.geometry-warning{margin-top:10px;padding:9px;background:#fff0e8;border:1px solid #e6b9a5;border-radius:5px}.geometry-warning strong,.geometry-warning span{display:block;font-size:10px;color:#9b4d37;line-height:1.6}.geometry-warning span{margin-top:3px}
.inspector label{font-weight:600;color:#526653;margin-top:16px}
.inspector input:not([type=range]),.inspector select{border-radius:5px}
.inspector .add-button,.inspector .danger-button{border-radius:6px!important}
.empty-inspector{padding:28px 12px;text-align:center;border:1px dashed #d7dfd3;border-radius:8px;color:#849080}
.empty-inspector-icon{display:block;font-size:28px;color:#9bad98}
.empty-inspector strong{display:block;margin-top:10px;font-size:12px;color:#526653}
.empty-inspector p{font-size:10px;line-height:1.7}
@media(max-width:1100px){.workspace{grid-template-columns:205px minmax(0,1fr) 240px}}
@media(max-width:760px){.workspace{grid-template-columns:132px minmax(0,1fr)}.tool-panel{padding:10px 8px}.asset-grid{grid-template-columns:1fr}.sidebar-overview{padding:9px}.sidebar-stats{gap:3px}.sidebar-stats>div{padding:6px 2px}.canvas-toolbar{padding:0 6px}.canvas-toolbar button{padding:6px}.stage-coordinates{display:none}}
</style>
