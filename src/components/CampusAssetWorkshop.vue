<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CAMPUS_BUILDING_TEMPLATES, createPixelBuilding } from '../three/world/campus/campusAssetLibrary.js'
import { CAMPUS_BUILDING_FOOTPRINTS } from '../data/campus/campusLayout.js'
import { createCampusAssetManifestFromWorkshopRecords } from '../data/campus/campusAssetManifest.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'

const STORAGE_KEY = 'ncgxy-campus-asset-workshop:v1'
const DB_NAME = 'ncgxy-campus-asset-files'
const DB_STORE = 'files'
const featureOptions = CAMPUS_BUILDING_FOOTPRINTS.map(item => ({
  featureId: item.id,
  name: item.label,
  category: 'building',
  confidence: item.confidence || 'unverified',
}))
const selectedFeatureId = ref(featureOptions[0]?.featureId || '')
const viewMode = ref('2.5d')
const sourceType = ref('ai_generated')
const extraPrompt = ref('')
const assetName = ref('')
const publicPath = ref('')
const generatedPrompt = ref('')
const selectedFile = ref(null)
const previewUrl = ref('')
const fileError = ref('')
const message = ref('')
const assets = ref(loadStoredAssets())
const activeAssetId = ref('')
const saving = ref(false)
const generating = ref(false)
const analyzingDesign = ref(false)
const imageApproved = ref(false)
const imageApprovalToken = ref('')
const buildingDesign = ref(null)
const generationModel = ref('')
const preview25d = ref(null)
const preview3d = ref(null)
const previewRenderers = []

function renderBuildingPreview(container, mode) {
  if (!container) return null
  const width = Math.max(260, container.clientWidth || 320)
  const height = Math.max(190, container.clientHeight || 230)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.replaceChildren(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#edf2eb')
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa58e, 2.1))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(10, 18, 12)
  keyLight.castShadow = true
  scene.add(keyLight)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 24), new THREE.MeshStandardMaterial({ color: '#cbd5c3', roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.08
  floor.receiveShadow = true
  scene.add(floor)
  const palette = { wallCream: '#e7d8b8', wallPeach: '#d9a58b', wallMint: '#b7c9ad', wall: '#d9d0bc', roof: '#8e5945', roofDark: '#684638', window: '#86aeb0', windowTrim: '#f1e5ca', door: '#795640' }
  const materials = Object.fromEntries(Object.entries(palette).map(([name, color]) => [name, new THREE.MeshStandardMaterial({ color, roughness: name === 'window' ? 0.3 : 0.86, metalness: name === 'window' ? 0.12 : 0 })]))
  const template = buildingDesign.value?.template || '教学楼'
  const preset = CAMPUS_BUILDING_TEMPLATES[template] || CAMPUS_BUILDING_TEMPLATES['教学楼']
  const design = buildingDesign.value || preset
  const building = createPixelBuilding(THREE, {
    width: 8, depth: 6, height: design.height || preset.height, template, materials,
    floors: design.floors ?? preset.floors, roofStyle: design.roofStyle || preset.roofStyle,
    roofRise: design.roofRise ?? preset.roofRise, windowDensity: design.windowDensity ?? preset.windowDensity,
    windowWidth: design.windowWidth ?? preset.windowWidth, windowHeight: design.windowHeight ?? preset.windowHeight,
    doorWidth: design.doorWidth ?? preset.doorWidth,
    wallMaterial: materials[design.wallPalette] || materials[preset.wall] || materials.wallCream,
  })
  scene.add(building)
  const aspect = width / height
  const camera = mode === '2.5d'
    ? new THREE.OrthographicCamera(-10 * aspect, 10 * aspect, 10, -10, 0.1, 100)
    : new THREE.PerspectiveCamera(38, aspect, 0.1, 100)
  camera.position.set(12, mode === '2.5d' ? 17 : 10, 15)
  camera.lookAt(0, 2.2, 0)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.enableRotate = true
  controls.enableZoom = true
  controls.minDistance = 7
  controls.maxDistance = 42
  controls.minZoom = 0.55
  controls.maxZoom = 2.4
  controls.target.set(0, 2.2, 0)
  controls.update()
  const render = () => renderer.render(scene, camera)
  controls.addEventListener('change', render)
  render()
  return { renderer, scene, materials, controls, render }
}
function disposeBuildingPreviews() {
  previewRenderers.splice(0).forEach(entry => {
    entry.controls.dispose()
    entry.renderer.dispose()
    Object.values(entry.materials).forEach(material => material.dispose())
    entry.scene.traverse(node => { if (node.geometry) node.geometry.dispose() })
  })
}
function refreshBuildingPreviews() {
  disposeBuildingPreviews()
  if (preview25d.value) { const entry = renderBuildingPreview(preview25d.value, '2.5d'); if (entry) previewRenderers.push(entry) }
  if (preview3d.value) { const entry = renderBuildingPreview(preview3d.value, '3d'); if (entry) previewRenderers.push(entry) }
}

function loadStoredAssets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(asset => asset.status === 'ready' && !asset.remoteFileId ? { ...asset, status: 'review', deployedConfirmed: false } : asset) : []
  } catch {
    return []
  }
}

function persistAssets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(assets.value))
}

function openAssetDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持本地文件暂存'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('打开本地文件暂存失败'))
  })
}

async function storeFile(key, blob) {
  const db = await openAssetDb()
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readwrite')
    transaction.objectStore(DB_STORE).put(blob, key)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error || new Error('写入本地文件失败'))
  })
  db.close()
}

async function readFile(key) {
  const db = await openAssetDb()
  const blob = await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readonly')
    const request = transaction.objectStore(DB_STORE).get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('读取本地文件失败'))
  })
  db.close()
  return blob
}

async function deleteFile(key) {
  if (!key || !('indexedDB' in window)) return
  const db = await openAssetDb()
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readwrite')
    transaction.objectStore(DB_STORE).delete(key)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error || new Error('删除本地文件失败'))
  })
  db.close()
}

const selectedFeature = computed(() => featureOptions.find(item => item.featureId === selectedFeatureId.value) || null)
const selectedAsset = computed(() => assets.value.find(item => item.assetId === activeAssetId.value) || null)
const readyCount = computed(() => assets.value.filter(item => item.status === 'ready').length)

function buildPrompt() {
  const feature = selectedFeature.value
  if (!feature) return
  const shape = viewMode.value === '2.5d'
    ? 'isometric architectural reference image, fixed three-quarter elevated camera, show front facade, side facade and roof simultaneously; make floors, windows, doors and roof geometry clearly readable for visual analysis'
    : 'complete stylized 3D game-ready architectural asset, all sides modeled, consistent scene scale, clean topology'
  const format = viewMode.value === '2.5d'
    ? 'single isolated building reference render, transparent background, PNG or WebP with alpha channel; this image is used only for visual analysis and human review, never as the final 2.5D or 3D scene asset'
    : 'optional high-detail 3D model for manual import compatibility, exportable as GLB/glTF, PBR materials, origin at footprint center, ground level at Y=0; the default AI workflow still generates shared procedural geometry'
  generatedPrompt.value = [
    'Create one original stylized low-poly campus architecture asset for a university exploration game.',
    'Asset identity: ' + feature.name + ' (' + feature.featureId + '). This is a temporary spatial label, not a verified official building name.',
    'Visual direction: cohesive warm pixel-campus / stylized low-poly game art, restrained natural colors, readable roof silhouette, clear facade rhythm, moderate detail, not photorealistic.',
    shape + '.',
    format + '.',
    'The asset must be one building only; no campus panorama, no terrain, no roads, no trees, no people, no labels, no signage text, no watermark, no border, no UI.',
    'Keep the silhouette compact and readable at small map scale. Avoid tiny details that disappear in an isometric overview.',
    'Do not invent school logos or claim to reproduce a real building. This is a visual placeholder pending reference-photo verification.',
    extraPrompt.value.trim() ? 'Additional requirements: ' + extraPrompt.value.trim() : '',
  ].filter(Boolean).join('\n\n')
  buildingDesign.value = null
  message.value = '提示词已生成。图片仅作为建筑外观参考和识别输入；识别参数由 Three.js 代码生成统一 3D 几何，供 2.5D 与 3D 两种视角共用。'
}

async function copyPrompt() {
  if (!generatedPrompt.value) buildPrompt()
  try {
    await navigator.clipboard.writeText(generatedPrompt.value)
    message.value = '提示词已复制'
  } catch {
    message.value = '浏览器未授权剪贴板，请手动复制提示词区域内容'
  }
}

async function generateImage() {
  if (viewMode.value !== '2.5d' || generating.value) return
  buildingDesign.value = null
  if (!generatedPrompt.value.trim()) buildPrompt()
  if (!generatedPrompt.value.trim()) return

  generating.value = true
  fileError.value = ''
  message.value = '正在调用图片生成模型，生成过程可能需要几十秒……'
  try {
    const response = await fetch(API_BASE + '/assets/ai-image/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-User-Id': DEV_USER_ID,
      },
      body: JSON.stringify({ prompt: generatedPrompt.value }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || '图片生成失败：HTTP ' + response.status)
    if (typeof payload.dataUrl !== 'string' || !payload.dataUrl.startsWith('data:image/')) {
      throw new Error('图片生成接口未返回有效图片数据')
    }

    const imageResponse = await fetch(payload.dataUrl)
    const blob = await imageResponse.blob()
    if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error('生成图片为空或超过 20 MB')
    const extension = payload.mimeType === 'image/jpeg' ? 'jpg' : payload.mimeType === 'image/webp' ? 'webp' : 'png'
    const fileName = 'ai-' + selectedFeatureId.value + '-' + Date.now() + '.' + extension
    const file = new File([blob], fileName, { type: payload.mimeType || blob.type || 'image/png' })

    resetPreview()
    imageApproved.value = false
    imageApprovalToken.value = ''
    selectedFile.value = file
    previewUrl.value = URL.createObjectURL(file)
    sourceType.value = 'ai_generated'
    generationModel.value = payload.model || 'gpt-image-2'
    assetName.value = (selectedFeature.value?.name || '校园素材') + ' · AI 建筑参考图'
    publicPath.value = ''
    message.value = '图片生成成功。请先检查轮廓、透明背景和风格，再保存为候选素材。'
  } catch (error) {
    fileError.value = error.message || '调用图片生成服务失败'
    message.value = ''
  } finally {
    generating.value = false
  }
}


async function approveReferenceImage() {
  if (analyzingDesign.value || !selectedFile.value) return
  try {
    const imageDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('读取参考图片失败'))
      reader.readAsDataURL(selectedFile.value)
    })
    const response = await fetch(API_BASE + '/assets/ai-image/approve-reference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({ imageDataUrl, approvalToken: imageApprovalToken.value }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.approvalToken) throw new Error(payload.message || '图片确认失败')
    imageApprovalToken.value = payload.approvalToken
    imageApproved.value = true
    message.value = '参考图片已确认。现在可以基于这张图片提取 3D 结构参数。'
  } catch (error) {
    fileError.value = error.message || '图片确认失败'
  }
}

async function analyzeBuildingReference() {
  if (analyzingDesign.value || !imageApproved.value || !imageApprovalToken.value) return
  try {
    let blob = selectedFile.value
    if (!blob && previewUrl.value) {
      const response = await fetch(previewUrl.value)
      if (!response.ok) throw new Error('无法读取当前参考图')
      blob = await response.blob()
    }
    if (!blob || !String(blob.type || '').startsWith('image/')) {
      throw new Error('请先生成或选择一张建筑参考图片')
    }
    if (blob.size > 20 * 1024 * 1024) throw new Error('参考图片不能超过 20 MB')
    const imageDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('读取参考图片失败'))
      reader.readAsDataURL(blob)
    })
    analyzingDesign.value = true
    fileError.value = ''
    message.value = '正在调用 deepseek-flash 分析建筑立面、楼层、屋顶和窗户参数……'
    const response = await fetch(API_BASE + '/assets/ai-image/analyze-building', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({ imageDataUrl }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || '建筑结构识别失败：HTTP ' + response.status)
    if (!payload.design || payload.design.schemaVersion !== 1) throw new Error('识别接口未返回有效建筑结构参数')
    buildingDesign.value = payload.design
    message.value = '结构参数已提取。请核对楼层、屋顶和立面特征，再保存候选并审核入库。'
  } catch (error) {
    fileError.value = error.message || '建筑结构识别失败'
  } finally {
    analyzingDesign.value = false
  }
}

function resetPreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  selectedFile.value = null
}

async function onFileChange(event) {
  buildingDesign.value = null
  imageApproved.value = false
  imageApprovalToken.value = ''
  fileError.value = ''
  resetPreview()
  const file = event.target.files?.[0]
  if (!file) return
  const isImage = file.type.startsWith('image/')
  const isGlb = file.name.toLowerCase().endsWith('.glb') || file.type === 'model/gltf-binary'
  if (viewMode.value === '2.5d' && !isImage) {
    fileError.value = '2.5D 素材请上传 PNG、WebP 等图片文件'
    event.target.value = ''
    return
  }
  if (viewMode.value === '3d' && !isGlb) {
    fileError.value = '3D 主素材当前要求 GLB 文件'
    event.target.value = ''
    return
  }
  if (!isImage && !isGlb) {
    fileError.value = '当前仅支持图片和 GLB 文件'
    event.target.value = ''
    return
  }
  selectedFile.value = file
  generationModel.value = ''
  previewUrl.value = URL.createObjectURL(file)
  if (!assetName.value) assetName.value = (selectedFeature.value?.name || '校园素材') + (viewMode.value === '2.5d' ? ' · 2.5D' : ' · 3D')
}

function suggestedPath(file) {
  if (!file) return ''
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  return viewMode.value === '3d'
    ? '/models/buildings/' + safeName
    : '/assets/campus/buildings/' + safeName
}

async function saveDraft() {
  if (!selectedFeature.value || !selectedFile.value || saving.value) return
  saving.value = true
  try {
    const assetId = 'campus-' + selectedFeature.value.featureId + '-' + viewMode.value.replace('.', '-') + '-' + Date.now()
    const fileKey = assetId + ':primary'
    await storeFile(fileKey, selectedFile.value)
    const record = {
      assetId,
      name: assetName.value.trim() || selectedFeature.value.name + ' · ' + viewMode.value,
      featureId: selectedFeature.value.featureId,
      featureName: selectedFeature.value.name,
      category: 'building',
      sourceType: sourceType.value,
      status: 'review',
      viewMode: viewMode.value,
      fileName: selectedFile.value.name,
      fileType: selectedFile.value.type || (viewMode.value === '3d' ? 'model/gltf-binary' : 'image/webp'),
      fileSize: selectedFile.value.size,
      fileKey,
      publicPath: publicPath.value.trim() || suggestedPath(selectedFile.value),
      prompt: generatedPrompt.value,
      generationModel: generationModel.value || null,
      buildingDesign: buildingDesign.value ? structuredClone(buildingDesign.value) : null,
      createdAt: new Date().toISOString(),
      deployedConfirmed: false,
    }
    assets.value.unshift(record)
    persistAssets()
    activeAssetId.value = assetId
    message.value = '候选素材已保存，状态为待审核。审核通过后将自动上传服务器并登记正式资产清单。'
    resetPreview()
    selectedFile.value = null
  } catch (error) {
    fileError.value = error.message || '素材暂存失败'
  } finally {
    saving.value = false
  }
}

async function selectAsset(asset) {
  activeAssetId.value = asset.assetId
  buildingDesign.value = asset.buildingDesign || null
  resetPreview()
  try {
    const blob = await readFile(asset.fileKey)
    if (blob) previewUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    fileError.value = error.message || '素材预览读取失败'
  }
}

function updateAsset(patch) {
  if (!selectedAsset.value) return
  Object.assign(selectedAsset.value, patch)
  persistAssets()
}

async function downloadAsset(asset) {
  const blob = await readFile(asset.fileKey)
  if (!blob) {
    fileError.value = '本地素材文件不存在，请重新上传'
    return
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = asset.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

async function removeAsset(asset) {
  await deleteFile(asset.fileKey)
  assets.value = assets.value.filter(item => item.assetId !== asset.assetId)
  if (activeAssetId.value === asset.assetId) {
    activeAssetId.value = ''
    resetPreview()
  }
  persistAssets()
  message.value = '本地候选记录已删除'
}


async function approveAsset(asset) {
  if (!asset || asset.status === 'ready' || saving.value) return
  saving.value = true
  fileError.value = ''
  message.value = '正在上传素材并登记正式资产清单……'
  try {
    const blob = await readFile(asset.fileKey)
    if (!blob) throw new Error('本地候选文件不存在，请重新生成或上传')
    const form = new FormData()
    form.append('file', blob, asset.fileName)
    form.append('featureId', asset.featureId)
    form.append('viewMode', asset.viewMode)
    form.append('sourceType', asset.sourceType)
    form.append('name', asset.name)
    form.append('generationModel', asset.generationModel || '')
    form.append('prompt', asset.prompt || '')
    if (asset.buildingDesign) form.append('buildingDesign', JSON.stringify(asset.buildingDesign))
    const response = await fetch(API_BASE + '/assets/visual-assets', {
      method: 'POST',
      headers: { 'X-Dev-User-Id': DEV_USER_ID },
      body: form,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || '正式入库失败：HTTP ' + response.status)
    updateAsset({
      status: 'ready',
      deployedConfirmed: true,
      remoteFileId: payload.fileId,
      remoteUrl: payload.url,
      remoteAssetId: payload.assetId || null,
      approvedAt: new Date().toISOString(),
    })
    message.value = '审核通过，素材已自动上传服务器并登记正式资产清单。'
  } catch (error) {
    fileError.value = error.message || '素材入库失败'
    message.value = '入库失败，候选仍保留在本地待审核状态，可重试。'
  } finally {
    saving.value = false
  }
}

function exportManifest() {
  const { manifest, report, skipped } = createCampusAssetManifestFromWorkshopRecords(
    assets.value,
    featureOptions.map(item => item.featureId),
  )
  if (!report.valid) {
    message.value = '导出校验失败：' + report.errors.map(item => item.message).join('；')
    return
  }
  if (!manifest.assets.length) {
    message.value = skipped.length
      ? '没有可导出的资产：请检查文件路径，并确认素材文件已放入项目 public 目录'
      : '没有已审核且确认入库的素材'
    return
  }
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'campus-assets.json'
  anchor.click()
  URL.revokeObjectURL(url)
  message.value = '已导出 ' + manifest.assets.length + ' 组资产、' + manifest.bindings.length + ' 条空间绑定。请将清单与素材文件一起提交到项目。'
}
function backToCampus() {
  window.location.assign('/')
}

watch([selectedFeatureId, viewMode, extraPrompt], () => {
  generatedPrompt.value = ''
})
watch([selectedFeatureId, viewMode], () => {
  buildingDesign.value = null
  resetPreview()
  generationModel.value = ''
  publicPath.value = ''
  fileError.value = ''
})
onMounted(() => nextTick(refreshBuildingPreviews))
watch([buildingDesign, selectedFeatureId], () => nextTick(refreshBuildingPreviews), { deep: true })
onBeforeUnmount(() => { resetPreview(); disposeBuildingPreviews() })
</script>

<template>
  <main class="asset-workshop">
    <header class="workshop-header">
      <div>
        <div class="eyebrow">NANCHANG INSTITUTE · ASSET PIPELINE</div>
        <h1>AI 素材工坊</h1>
        <p>AI 生成优先 · 人工建模兼容 · 空间数据独立</p>
      </div>
      <button class="secondary-button" @click="backToCampus">返回校园地图</button>
    </header>

    <section class="workshop-summary">
      <div><strong>{{ assets.length }}</strong><span>本地候选</span></div>
      <div><strong>{{ readyCount }}</strong><span>已审核并确认入库</span></div>
      <div><strong>2.5D / 3D</strong><span>双视角资产</span></div>
      <p>候选先在浏览器暂存；审核通过后自动上传服务器并登记正式清单。</p>
    </section>

    <div class="workshop-grid">
      <section class="workshop-panel generation-panel">
        <div class="panel-heading"><span>01 / 生成任务</span><small>先生成候选，再审核</small></div>
        <label>绑定校园对象
          <select v-model="selectedFeatureId">
            <option v-for="feature in featureOptions" :key="feature.featureId" :value="feature.featureId">{{ feature.name }} · {{ feature.featureId }}</option>
          </select>
        </label>
        <div class="field-row">
          <label>素材视角
            <select v-model="viewMode">
              <option value="2.5d">2.5D 等距图片</option>
              <option value="3d">3D GLB 模型</option>
            </select>
          </label>
          <label>素材来源
            <select v-model="sourceType">
              <option value="ai_generated">AI 生成</option>
              <option value="manual_model">人工建模</option>
              <option value="procedural">程序化生成</option>
              <option value="external">外部素材</option>
            </select>
          </label>
        </div>
        <label>补充要求
          <textarea v-model="extraPrompt" rows="3" placeholder="例如：红褐色坡屋顶、浅米色外墙、正面有三层窗户节奏……"></textarea>
        </label>
        <div class="button-row">
          <button class="primary-button" @click="buildPrompt">生成提示词</button>
          <button class="secondary-button" :disabled="!generatedPrompt" @click="copyPrompt">复制提示词</button>
          <button class="primary-button" :disabled="viewMode !== '2.5d' || generating" @click="generateImage">{{ generating ? 'AI 生成中…' : '生成建筑参考图' }}</button>
          <button class="secondary-button" :disabled="viewMode !== '2.5d' || !selectedFile || analyzingDesign || imageApproved" @click="approveReferenceImage">{{ imageApproved ? '图片已确认' : '确认图片预览' }}</button>
          <button class="secondary-button" :disabled="!imageApproved || analyzingDesign" @click="analyzeBuildingReference">{{ analyzingDesign ? '结构识别中…' : '确认后识别并生成3D参数' }}</button>
        </div>
        <label>AI 生成提示词
          <textarea v-model="generatedPrompt" rows="10" placeholder="生成提示词后可在此修改、复制到你使用的 AI 工具"></textarea>
        </label>
        <p class="hint">AI 图片只作为建筑外观参考，不直接显示在校园地图中。识图模型提取楼层、屋顶、窗户、门和墙面配色参数；Three.js 参数化几何生成器据此构建统一 3D 实体，2.5D 与 3D 共用该实体，仅相机和交互方式不同。识别结果是视觉估算，不是实测数据。</p>
        <div v-if="buildingDesign" class="design-result">
          <strong>3D 结构参数已提取 · 置信度 {{ Math.round(buildingDesign.confidence * 100) }}%</strong>
          <span>{{ buildingDesign.template }} · {{ buildingDesign.floors }} 层 · {{ buildingDesign.roofStyle }} 屋顶 · {{ buildingDesign.wallPalette }}</span>
          <small>高度使用场景视觉单位估算，不代表真实建筑高度。{{ (buildingDesign.limitations || []).join('；') }}</small>
        </div>
      </section>

      <section class="workshop-panel preview-panel">
        <div class="panel-heading"><span>02 / 双视角实时建模预览</span><small>同一套 Three.js Mesh · 可交互检查</small></div>
        <div class="dual-preview-grid">
          <div class="preview-card"><strong>2.5D · 固定斜俯视</strong><div ref="preview25d" class="three-preview"></div><small>正交投影 · 拖动旋转检查背面 · 滚轮缩放</small></div>
          <div class="preview-card"><strong>3D · 透视观察</strong><div ref="preview3d" class="three-preview"></div><small>透视投影 · 拖动旋转检查背面 · 滚轮缩放</small></div>
        </div>
        <p class="hint">识别参数更新后，两侧预览同步重建。参考图片仅用于结构识别和人工审核，不作为任一视角的最终显示素材。</p>
      </section>
      <section class="workshop-panel intake-panel">
        <div class="panel-heading"><span>03 / 素材收集</span><small>{{ viewMode === '2.5d' ? 'PNG / WebP 图片' : 'GLB 模型' }}</small></div>
        <label>素材名称
          <input v-model="assetName" placeholder="例如：西侧组团 01 · AI 视觉稿" />
        </label>
        <label class="upload-zone">
          <input type="file" :accept="viewMode === '3d' ? '.glb,model/gltf-binary' : 'image/png,image/webp,image/jpeg'" @change="onFileChange" />
          <strong>选择 AI 生成文件或建模文件</strong>
          <span>{{ selectedFile ? selectedFile.name + ' · ' + Math.ceil(selectedFile.size / 1024) + ' KB' : '文件先暂存到浏览器，审核通过后自动上传服务器' }}</span>
        </label>
        <div v-if="previewUrl" class="asset-preview">
          <img v-if="selectedFile?.type.startsWith('image/') || selectedAsset?.viewMode === '2.5d'" :src="previewUrl" alt="素材预览" />
          <div v-else class="model-placeholder">GLB 文件已暂存<br /><small>当前页面不执行 3D 模型实时预览</small></div>
        </div>
        <div class="button-row">
          <button class="primary-button" :disabled="!selectedFile || saving" @click="saveDraft">{{ saving ? '暂存中…' : '保存为候选素材' }}</button>
          <button class="secondary-button" @click="resetPreview">清除预览</button>
        </div>
        <p v-if="fileError" class="error-text">{{ fileError }}</p>
      </section>
    </div>

    <section class="workshop-panel library-panel">
      <div class="panel-heading"><span>04 / 候选审核</span><small>审核通过后自动上传并登记服务器资产清单</small></div>
      <div v-if="!assets.length" class="empty-state">还没有候选素材。先生成提示词，再上传第一份 AI 素材。</div>
      <div v-else class="asset-table">
        <button v-for="asset in assets" :key="asset.assetId" :class="['asset-row', { active: activeAssetId === asset.assetId }]" @click="selectAsset(asset)">
          <span><strong>{{ asset.name }}</strong><small>{{ asset.featureId }} · {{ asset.viewMode }} · {{ asset.fileName }}</small></span>
          <em :class="'status-' + asset.status">{{ asset.status === 'draft' ? '草稿' : asset.status === 'review' ? '待审核' : asset.status === 'ready' ? '已入库' : asset.status === 'rejected' ? '已驳回' : '已归档' }}</em>
        </button>
      </div>
      <div v-if="selectedAsset" class="review-panel">
        <div class="review-preview">
          <img v-if="selectedAsset.viewMode === '2.5d' && previewUrl" :src="previewUrl" alt="候选素材预览" />
          <div v-else-if="selectedAsset.viewMode === '3d'" class="model-placeholder">GLB · {{ (selectedAsset.fileSize / 1024).toFixed(0) }} KB</div>
        </div>
        <div class="review-fields">
          <label>资产名称<input :value="selectedAsset.name" @input="updateAsset({ name: $event.target.value })" /></label>
          <div class="button-row">
            <button class="primary-button" :disabled="selectedAsset.status === 'ready' || saving" @click="approveAsset(selectedAsset)">{{ saving ? '入库中…' : selectedAsset.status === 'ready' ? '已正式入库' : '审核通过并自动入库' }}</button>
            <button class="secondary-button" @click="downloadAsset(selectedAsset)">下载原始文件</button>
            <button class="secondary-button" :disabled="selectedAsset.status === 'ready'" @click="updateAsset({ status: 'review', deployedConfirmed: false })">重新提交审核</button>
            <button class="danger-button" :disabled="selectedAsset.status === 'ready'" @click="updateAsset({ status: 'rejected', deployedConfirmed: false })">驳回候选</button>
            <button class="danger-button" :disabled="selectedAsset.status === 'ready'" @click="removeAsset(selectedAsset)">删除候选</button>
          </div>
          <small class="hint">审核前请检查：风格一致、边缘干净、比例合理、无文字水印、文件格式正确；3D 模型还需检查朝向、原点、地面高度和网格结构。</small>
        </div>
      </div>
      <div class="export-row">
        <span>正式资产清单由服务端自动维护，无需手动导出或复制文件。</span>
      </div>
      <p v-if="message" class="status-message">{{ message }}</p>
    </section>

    <footer class="workshop-footer">
      <strong>数据边界</strong>
      <span>AI 图片只作为建筑外观参考和识别资料，不作为地图中的平面贴图；deepseek-flash 从参考图提取参数，Three.js 代码据此生成统一 3D 墙体、楼层、屋顶、窗户和门，供 2.5D/3D 共用。建筑位置、footprint、碰撞、walkable 仍由校园空间 FeatureCollection 管理。人工 GLB 导入继续作为可选兼容路径。识别参数属于视觉估算，不是测绘事实。</span>
    </footer>
  </main>
</template>

<style scoped>
.asset-workshop{min-height:100%;height:100%;overflow:auto;padding:34px clamp(18px,4vw,64px) 48px;background:#edf1eb;color:#25352d;font-family:Manrope,'Noto Sans SC',sans-serif}
.workshop-header{display:flex;align-items:center;justify-content:space-between;gap:24px;max-width:1440px;margin:0 auto 24px}
.eyebrow{font:10px 'DM Mono',monospace;letter-spacing:2px;color:#6c806d}
.workshop-header h1{margin:8px 0 4px;font-size:clamp(26px,3vw,38px);letter-spacing:1px}
.workshop-header p{margin:0;color:#718076;font-size:13px}
.workshop-summary{display:flex;align-items:center;gap:26px;max-width:1440px;margin:0 auto 20px;padding:16px 20px;border:1px solid #d9e1d7;background:#fff;border-radius:10px}
.workshop-summary div{display:flex;flex-direction:column;gap:3px}.workshop-summary strong{font-size:22px}.workshop-summary span,.workshop-summary p{font-size:11px;color:#829087}.workshop-summary p{margin-left:auto}
.dual-preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.preview-card{min-width:0;padding:12px;border:1px solid #e1e8df;border-radius:8px;background:#f9fbf8}.preview-card>strong{display:block;margin-bottom:8px}.three-preview{height:240px;overflow:hidden;border-radius:6px;background:#edf2eb}.three-preview canvas{display:block;width:100%;height:100%}.preview-card>small{display:block;margin-top:8px;color:#65736a}.workshop-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(320px,.95fr);gap:18px;max-width:1440px;margin:0 auto 18px}
.workshop-panel{padding:22px;border:1px solid #d9e1d7;border-radius:10px;background:#fff;box-shadow:0 8px 24px rgba(37,53,45,.035)}
.panel-heading{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:20px;font-size:12px;font-weight:800;letter-spacing:.7px}.panel-heading small{font-size:10px;font-weight:500;color:#8a978d}
.workshop-panel label{display:flex;flex-direction:column;gap:7px;margin:13px 0;font-size:11px;font-weight:700;color:#526257}
.workshop-panel input:not([type=file]):not([type=checkbox]),.workshop-panel select,.workshop-panel textarea{width:100%;padding:10px 11px;border:1px solid #dce4da;border-radius:6px;background:#fbfcfa;color:#26372e;font:inherit;font-size:12px;outline:none}
.workshop-panel textarea{resize:vertical;line-height:1.65}.workshop-panel input:focus,.workshop-panel select:focus,.workshop-panel textarea:focus{border-color:#829b83}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.button-row{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
.primary-button,.secondary-button,.danger-button{padding:9px 13px;border:1px solid #315b43;border-radius:6px;background:#315b43;color:#fff;font:inherit;font-size:11px;font-weight:600;cursor:pointer}
.secondary-button{border-color:#d6dfd4;background:#fff;color:#465b4b}.danger-button{border-color:#ecd3cf;background:#fff7f6;color:#a24d43}
button:disabled{opacity:.45;cursor:not-allowed}
.hint{font-size:10px;line-height:1.7;color:#8b988e}
.upload-zone{display:flex!important;align-items:center;justify-content:center;min-height:120px;padding:18px;border:1px dashed #b8c7b6;border-radius:8px;background:#f7faf6;text-align:center;cursor:pointer}
.upload-zone input{max-width:100%;font-size:10px}.upload-zone strong{font-size:12px;color:#405c47}.upload-zone span{font-size:10px;color:#87958a}
.asset-preview{display:grid;place-items:center;min-height:150px;max-height:280px;overflow:hidden;border:1px solid #e3e9e1;border-radius:8px;background:linear-gradient(45deg,#f1f4ef 25%,transparent 25%),linear-gradient(-45deg,#f1f4ef 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f1f4ef 75%),linear-gradient(-45deg,transparent 75%,#f1f4ef 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
.asset-preview img,.review-preview img{display:block;max-width:100%;max-height:260px;object-fit:contain}
.model-placeholder{padding:32px;text-align:center;color:#708075;font-size:12px}.model-placeholder small{font-size:10px}.design-result{display:flex;flex-direction:column;gap:6px;margin:12px 0;padding:12px;border:1px solid #dce6d9;border-radius:7px;background:#f5f9f3;color:#45604b;font-size:11px}.design-result small{color:#829087;line-height:1.6}
.error-text{color:#b44e43;font-size:11px}
.library-panel{max-width:1440px;margin:0 auto}
.asset-table{display:flex;flex-direction:column;gap:6px}
.asset-row{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:12px 14px;border:1px solid #e2e8df;border-radius:7px;background:#fff;color:#2d4034;text-align:left;cursor:pointer}
.asset-row.active{border-color:#7d9a7d;background:#f5f9f3}.asset-row span{display:flex;flex-direction:column;gap:5px}.asset-row strong{font-size:12px}.asset-row small{font-size:10px;color:#849187}.asset-row em{font-size:10px;font-style:normal;color:#a27b45}.asset-row .status-ready{color:#3e7a4b}
.empty-state{padding:28px;border:1px dashed #d9e1d7;border-radius:8px;color:#89968c;text-align:center;font-size:12px}
.review-panel{display:grid;grid-template-columns:minmax(180px,.7fr) minmax(260px,1.3fr);gap:18px;margin-top:16px;padding:16px;border:1px solid #e1e8df;border-radius:8px;background:#f9fbf8}
.review-preview{display:grid;place-items:center;min-height:160px;overflow:hidden;border-radius:6px;background:#edf2eb}.review-fields label{margin-top:0}.confirm-row{display:flex!important;flex-direction:row!important;align-items:center;gap:8px!important;font-weight:500!important}.confirm-row input{margin:0}
.export-row{display:flex;align-items:center;gap:14px;margin-top:18px}.export-row span,.status-message{font-size:10px;color:#7f8d82;line-height:1.6}.status-message{margin-top:10px;color:#456a4c}
.workshop-footer{display:flex;gap:16px;max-width:1440px;margin:18px auto 0;padding:14px 2px;border-top:1px solid #d8e1d6;color:#7a887d;font-size:10px;line-height:1.7}.workshop-footer strong{flex:none;color:#4e6353}
@media(max-width:900px){.dual-preview-grid{grid-template-columns:1fr}.workshop-grid{grid-template-columns:1fr}.workshop-summary{flex-wrap:wrap}.workshop-summary p{width:100%;margin:0}.review-panel{grid-template-columns:1fr}}
@media(max-width:600px){.asset-workshop{padding:20px 12px 32px}.workshop-header{align-items:flex-start}.workshop-header .secondary-button{white-space:nowrap;padding:8px}.workshop-panel{padding:16px}.field-row{grid-template-columns:1fr}.workshop-summary{gap:14px;padding:13px}.workshop-summary div{min-width:70px}.export-row{align-items:flex-start;flex-direction:column}}
</style>
