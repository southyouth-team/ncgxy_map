<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { CAMPUS_BUILDING_FOOTPRINTS } from '../data/campus/campusLayout.js'
import { createCampusAssetManifestFromWorkshopRecords } from '../data/campus/campusAssetManifest.js'

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

function loadStoredAssets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
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
    ? '2.5D isometric game asset, fixed three-quarter elevated camera, show front facade and roof simultaneously'
    : 'complete stylized 3D game-ready architectural asset, all sides modeled, consistent real-world scale, clean topology'
  const format = viewMode.value === '2.5d'
    ? 'single isolated building render, transparent background, PNG or WebP with alpha channel'
    : 'single isolated 3D building model, exportable as GLB/glTF, PBR materials, origin at footprint center, ground level at Y=0'
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
  message.value = '已生成可复制的素材提示词。请使用 AI 图像/3D 工具生成候选，再上传到此处审核。'
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

function resetPreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  selectedFile.value = null
}

async function onFileChange(event) {
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
      status: 'draft',
      viewMode: viewMode.value,
      fileName: selectedFile.value.name,
      fileType: selectedFile.value.type || (viewMode.value === '3d' ? 'model/gltf-binary' : 'image/webp'),
      fileSize: selectedFile.value.size,
      fileKey,
      publicPath: publicPath.value.trim() || suggestedPath(selectedFile.value),
      prompt: generatedPrompt.value,
      createdAt: new Date().toISOString(),
      deployedConfirmed: false,
    }
    assets.value.unshift(record)
    persistAssets()
    activeAssetId.value = assetId
    message.value = '候选素材已保存到当前浏览器的本地暂存库；尚未进入正式资产清单。'
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
onBeforeUnmount(resetPreview)
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
      <p>当前为浏览器本地暂存，不会自动上传服务器或修改正式校园场景。</p>
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
        </div>
        <label>AI 生成提示词
          <textarea v-model="generatedPrompt" rows="10" placeholder="生成提示词后可在此修改、复制到你使用的 AI 工具"></textarea>
        </label>
        <p class="hint">提示词会明确素材是视觉占位，不会伪造真实楼栋外观。没有实景照片时，不应将结果标记为真实还原。</p>
      </section>

      <section class="workshop-panel intake-panel">
        <div class="panel-heading"><span>02 / 素材收集</span><small>{{ viewMode === '2.5d' ? 'PNG / WebP 图片' : 'GLB 模型' }}</small></div>
        <label>素材名称
          <input v-model="assetName" placeholder="例如：西侧组团 01 · AI 视觉稿" />
        </label>
        <label>项目内目标路径
          <input v-model="publicPath" :placeholder="viewMode === '3d' ? '/models/buildings/asset.glb' : '/assets/campus/buildings/asset.webp'" />
        </label>
        <label class="upload-zone">
          <input type="file" :accept="viewMode === '3d' ? '.glb,model/gltf-binary' : 'image/png,image/webp,image/jpeg'" @change="onFileChange" />
          <strong>选择 AI 生成文件或建模文件</strong>
          <span>{{ selectedFile ? selectedFile.name + ' · ' + Math.ceil(selectedFile.size / 1024) + ' KB' : '文件会暂存到当前浏览器 IndexedDB' }}</span>
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
      <div class="panel-heading"><span>03 / 候选审核</span><small>仅 ready 且确认文件已入库的素材可导出</small></div>
      <div v-if="!assets.length" class="empty-state">还没有候选素材。先生成提示词，再上传第一份 AI 素材。</div>
      <div v-else class="asset-table">
        <button v-for="asset in assets" :key="asset.assetId" :class="['asset-row', { active: activeAssetId === asset.assetId }]" @click="selectAsset(asset)">
          <span><strong>{{ asset.name }}</strong><small>{{ asset.featureId }} · {{ asset.viewMode }} · {{ asset.fileName }}</small></span>
          <em :class="'status-' + asset.status">{{ asset.status === 'draft' ? '草稿' : asset.status === 'review' ? '待审核' : asset.status === 'ready' ? '已就绪' : '已归档' }}</em>
        </button>
      </div>
      <div v-if="selectedAsset" class="review-panel">
        <div class="review-preview">
          <img v-if="selectedAsset.viewMode === '2.5d' && previewUrl" :src="previewUrl" alt="候选素材预览" />
          <div v-else-if="selectedAsset.viewMode === '3d'" class="model-placeholder">GLB · {{ (selectedAsset.fileSize / 1024).toFixed(0) }} KB</div>
        </div>
        <div class="review-fields">
          <label>资产名称<input :value="selectedAsset.name" @input="updateAsset({ name: $event.target.value })" /></label>
          <label>正式文件路径<input :value="selectedAsset.publicPath" @input="updateAsset({ publicPath: $event.target.value, deployedConfirmed: false })" /></label>
          <label class="confirm-row"><input type="checkbox" :checked="selectedAsset.deployedConfirmed" @change="updateAsset({ deployedConfirmed: $event.target.checked, status: $event.target.checked ? 'ready' : 'review' })" />我已将对应文件放入项目 public 目录并核对路径</label>
          <div class="button-row">
            <button class="secondary-button" @click="downloadAsset(selectedAsset)">下载原始文件</button>
            <button class="secondary-button" @click="updateAsset({ status: 'review', deployedConfirmed: false })">设为待审核</button>
            <button class="danger-button" @click="removeAsset(selectedAsset)">删除候选</button>
          </div>
          <small class="hint">审核前请检查：风格一致、边缘干净、比例合理、无文字水印、文件格式正确；3D 模型还需检查朝向、原点、地面高度和网格结构。</small>
        </div>
      </div>
      <div class="export-row">
        <button class="primary-button" :disabled="!readyCount" @click="exportManifest">导出正式资产清单</button>
        <span>导出前会重新校验路径、素材类型和空间 Feature 绑定。</span>
      </div>
      <p v-if="message" class="status-message">{{ message }}</p>
    </section>

    <footer class="workshop-footer">
      <strong>数据边界</strong>
      <span>素材工坊只维护视觉资产。建筑位置、footprint、碰撞、walkable 和道路连接仍由校园空间 FeatureCollection 管理。当前版本不提供云端生成 API、服务端文件上传或自动部署。</span>
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
.workshop-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(320px,.95fr);gap:18px;max-width:1440px;margin:0 auto 18px}
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
.model-placeholder{padding:32px;text-align:center;color:#708075;font-size:12px}.model-placeholder small{font-size:10px}
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
@media(max-width:900px){.workshop-grid{grid-template-columns:1fr}.workshop-summary{flex-wrap:wrap}.workshop-summary p{width:100%;margin:0}.review-panel{grid-template-columns:1fr}}
@media(max-width:600px){.asset-workshop{padding:20px 12px 32px}.workshop-header{align-items:flex-start}.workshop-header .secondary-button{white-space:nowrap;padding:8px}.workshop-panel{padding:16px}.field-row{grid-template-columns:1fr}.workshop-summary{gap:14px;padding:13px}.workshop-summary div{min-width:70px}.export-row{align-items:flex-start;flex-direction:column}}
</style>
