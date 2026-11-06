<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { createCampusEngine } from '../three/engine/createCampusEngine.js'
import { executeProceduralModel } from '../three/sandbox/executeProceduralModel.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'
const viewport = ref(null)
const selectedName = ref('')
const objects = ref([])
const command = ref('')
const aiPrompt = ref('')
const referenceImageDataUrl = ref('')
const referenceImageName = ref('')
const aiBusy = ref(false)
const message = ref('正在初始化 RPG 校园场景…')
const time = ref(14)
const weather = ref('clear')
const wind = ref(20)
const transformMode = ref('translate')
const objectTypes = [
  { id: 'box', label: '立方体' }, { id: 'sphere', label: '球体' },
  { id: 'cylinder', label: '圆柱体' }, { id: 'cone', label: '圆锥体' },
  { id: 'torus', label: '环形体' },
]
let engine = null
let selected = null
let disposed = false
const objectsById = new Map()

function syncObjects() {
  objects.value = engine?.getSandboxModels?.() || []
  selectedName.value = selected?.name || ''
}
function handleModelSelected(payload) {
  selected = payload?.id ? objectsById.get(payload.id) || null : null
  selectedName.value = selected?.name || ''
}
function registerModel(root, name, position = null) {
  root.name = name || root.name || '模型'
  const id = engine.addSandboxModel(root, { name: root.name, position })
  objectsById.set(id, root)
  selected = root
  syncObjects()
  message.value = '已添加建模组：' + root.name
  return root
}
function addModel(type) {
  const geometries = {
    box: () => new THREE.BoxGeometry(2, 2, 2),
    sphere: () => new THREE.SphereGeometry(1.15, 32, 24),
    cylinder: () => new THREE.CylinderGeometry(1, 1, 2, 32),
    cone: () => new THREE.ConeGeometry(1.1, 2.2, 32),
    torus: () => new THREE.TorusKnotGeometry(0.8, 0.28, 100, 16),
  }
  const mesh = new THREE.Mesh((geometries[type] || geometries.box)(), new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random(), 0.42, 0.56), roughness: 0.68,
  }))
  mesh.name = objectTypes.find(item => item.id === type)?.label || '模型'
  mesh.position.y = type === 'torus' ? 1.4 : 1
  const group = new THREE.Group()
  group.add(mesh)
  registerModel(group, mesh.name + ' ' + (objects.value.length + 1))
}
function selectModel(object) {
  if (object) engine?.selectSandboxModel(object.userData.sandboxModelId)
}
function setMode(mode) {
  transformMode.value = mode
  engine?.setSandboxTransformMode(mode)
}
function deleteSelected() {
  if (!selected) return
  const id = selected.userData.sandboxModelId
  engine?.removeSandboxModel(id)
  objectsById.delete(id)
  selected = null
  syncObjects()
  message.value = '已删除模型组'
}
function duplicateSelected() {
  if (!selected) return
  const newId = engine?.duplicateSandboxModel(selected.userData.sandboxModelId)
  if (newId) {
    const copy = engine.getSandboxModel(newId)
    if (copy) { objectsById.set(newId, copy); selected = copy; engine.selectSandboxModel(newId) }
    syncObjects()
    message.value = '已复制模型组'
  }
}
function onReferenceImageChange(event) {
  const file = event.target.files?.[0]
  referenceImageDataUrl.value = ''
  referenceImageName.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    message.value = '参考图仅支持 PNG、JPG 或 WebP'
    event.target.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    message.value = '参考图不能超过 10 MB'
    event.target.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    referenceImageDataUrl.value = String(reader.result || '')
    referenceImageName.value = file.name
    message.value = '参考图已就绪，可以开始生成'
  }
  reader.onerror = () => { message.value = '参考图读取失败' }
  reader.readAsDataURL(file)
}
async function generateAiModel() {
  const prompt = aiPrompt.value.trim()
  if ((!prompt && !referenceImageDataUrl.value) || aiBusy.value) return
  aiBusy.value = true
  message.value = '正在生成 Three.js 程序化模型源码…'
  try {
    const response = await fetch(API_BASE + '/assets/ai-image/generate-procedural-object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({
        prompt,
        objectType: '独立 3D 模型',
        visualStyle: 'stylized',
        imageDataUrl: referenceImageDataUrl.value || undefined,
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || '程序化模型生成失败：HTTP ' + response.status)
    const result = payload.data || payload.result || payload
    if (typeof result.generatedCode !== 'string' || !result.generatedCode.trim()) {
      throw new Error('生成接口没有返回 Three.js 程序化源码')
    }

    message.value = '源码已返回，正在隔离执行并构建 THREE.Group…'
    const group = await executeProceduralModel(result.generatedCode, { timeoutMs: 25000 })
    const modelName = group.userData.assetName || result.objectType || 'AI 程序化模型'
    group.userData.proceduralModelConfig = {
      protocol: 'threejs-procedural-v1',
      generator: result.generationMethod || 'img2threejs-procedural',
      objectType: result.objectType || '独立 3D 模型',
      visualStyle: result.visualStyle || 'stylized',
      prompt,
      hasReferenceImage: Boolean(referenceImageDataUrl.value),
      generatedAt: result.generatedAt || new Date().toISOString(),
    }
    // 源码保留在实例元数据中，后续可用于重生成；场景实际使用的是 ObjectLoader 还原的 THREE.Group。
    group.userData.proceduralModelSource = result.generatedCode
    group.userData.interactionRadius = Number(group.userData.interactionRadius) || 4.5
    registerModel(group, modelName + ' ' + (objects.value.length + 1))
    aiPrompt.value = ''
    referenceImageDataUrl.value = ''
    referenceImageName.value = ''
  } catch (error) {
    message.value = 'AI 程序化建模失败：' + (error?.message || '未知错误')
  } finally {
    aiBusy.value = false
  }
}
function updateEnvironment() {
  if (!engine) return
  engine.setEnvironment({
    timeOfDay: Number(time.value) < 6 || Number(time.value) >= 18 ? 'night' : 'day',
    weather: weather.value === 'rain' ? 'rain' : 'clear',
    wind: Number(wind.value) / 100,
  })
}
function executeTask() {
  const text = command.value.trim()
  if (!text) return
  if (/创建.*(立方体|方块|cube)/i.test(text)) addModel('box')
  else if (/创建.*(球体|球|sphere)/i.test(text)) addModel('sphere')
  else if (/创建.*(圆柱|cylinder)/i.test(text)) addModel('cylinder')
  else if (/创建.*(圆锥|cone)/i.test(text)) addModel('cone')
  else if (/创建.*(环形|torus)/i.test(text)) addModel('torus')
  else if (/雨|rain/i.test(text)) { weather.value = 'rain'; updateEnvironment(); message.value = '环境已切换为雨天' }
  else if (/晴天|放晴|clear/i.test(text)) { weather.value = 'clear'; updateEnvironment(); message.value = '环境已切换为晴天' }
  else if (/(时间|time)[^0-9]*(\d{1,2})/i.test(text)) {
    const hour = Number(text.match(/(?:时间|time)[^0-9]*(\d{1,2})/i)[1])
    time.value = Math.min(24, Math.max(0, hour))
    updateEnvironment()
    message.value = '时间已调整为 ' + time.value + ':00'
  } else if (/删除|delete/i.test(text)) deleteSelected()
  else if (/复制|duplicate/i.test(text)) duplicateSelected()
  else if (/移动|move/i.test(text)) {
    const match = text.match(/(-?\d+(?:\.\d+)?)[,，\s]+(-?\d+(?:\.\d+)?)[,，\s]+(-?\d+(?:\.\d+)?)/)
    if (!selected) message.value = '请先选择一个模型'
    else if (!match) message.value = '移动指令格式：移动 2,0,3'
    else { selected.position.set(Number(match[1]), Number(match[2]), Number(match[3])); message.value = '模型已移动到指定坐标' }
  } else if (/旋转|rotate/i.test(text)) {
    const degrees = Number((text.match(/-?\d+(?:\.\d+)?/) || [0])[0])
    if (!selected) message.value = '请先选择一个模型'
    else { selected.rotation.y += THREE.MathUtils.degToRad(degrees); message.value = '模型已旋转 ' + degrees + '°' }
  } else message.value = '试试：创建球体、移动 2,0,3、旋转 45、切换雨天、时间 18 点、复制、删除。'
  command.value = ''
  syncObjects()
}
onMounted(async () => {
  disposed = false
  try {
    engine = createCampusEngine(viewport.value, {
      onReady: () => { message.value = 'RPG 校园场景已就绪，使用 WASD 或方向键移动人物。' },
      onError: error => { message.value = '校园场景初始化失败：' + (error?.message || '未知错误') },
      onSandboxModelsChange: list => { objects.value = list },
      onSandboxModelSelected: handleModelSelected,
      onSandboxInteractionPromptChange: payload => {
        if (payload?.visible) message.value = payload.text
        else if (message.value.startsWith('靠近 ')) message.value = '使用 WASD 或方向键移动人物，靠近模型按 E 交互。'
      },
      onSandboxModelInteract: payload => { message.value = payload?.message || ('已与 ' + (payload?.name || '模型') + ' 交互') },
    }, {
      // 直接复用仓库已有的小型 RPG 样板场景，不加载完整校园 GIS 主地图。
      sceneType: 'rpg-sample',
      isometricRpg: true,
      viewMode: '3d',
    })
    await engine.init()
    if (disposed) return
    engine.setMode('thirdPerson')
    engine.setSandboxTransformMode(transformMode.value)
    updateEnvironment()
    syncObjects()
  } catch (error) {
    message.value = '校园场景初始化失败：' + (error?.message || '未知错误')
  }
})
onBeforeUnmount(() => {
  disposed = true
  engine?.dispose()
  engine = null
  objectsById.clear()
  selected = null
})
</script>

<template>
  <main class="world-mvp">
    <div ref="viewport" class="world-mvp__viewport"></div>
    <header class="world-mvp__header">
      <div class="world-mvp__brand"><strong>WORLD SANDBOX</strong><span>RPG 校园探索 · AI 独立建模组</span></div>
      <a href="/">返回地图</a>
    </header>

    <aside class="world-mvp__panel">
      <section>
        <h2>AI 建模</h2>
        <div class="world-mvp__command">
          <input v-model="aiPrompt" placeholder="描述模型，例如：一栋带玻璃幕墙的现代图书馆" @keydown.enter="generateAiModel">
          <button :disabled="aiBusy || (!aiPrompt.trim() && !referenceImageDataUrl)" @click="generateAiModel">{{ aiBusy ? '生成中' : '生成' }}</button>
        </div>
        <div class="world-mvp__command" style="margin-top:7px">
          <input type="file" accept="image/png,image/jpeg,image/webp" @change="onReferenceImageChange">
        </div>
        <p v-if="referenceImageName" class="world-mvp__message">参考图：{{ referenceImageName }}</p>
        <p class="world-mvp__message">AI 返回 Three.js 源码，在隔离环境构建后直接加入 RPG 场景；不经过 GLB。</p>
      </section>
      <section>
        <h2>基础模型</h2>
        <div class="world-mvp__model-grid">
          <button v-for="item in objectTypes" :key="item.id" @click="addModel(item.id)">＋ {{ item.label }}</button>
        </div>
        <div class="world-mvp__selected">
          <span>当前对象</span><strong>{{ selectedName || '未选择' }}</strong>
          <button :disabled="!selectedName" @click="duplicateSelected">复制</button><button :disabled="!selectedName" @click="deleteSelected">删除</button>
        </div>
        <div class="world-mvp__tools">
          <button :class="{ active: transformMode === 'translate' }" :disabled="!selectedName" @click="setMode('translate')">移动</button>
          <button :class="{ active: transformMode === 'rotate' }" :disabled="!selectedName" @click="setMode('rotate')">旋转</button>
          <button :class="{ active: transformMode === 'scale' }" :disabled="!selectedName" @click="setMode('scale')">缩放</button>
        </div>
        <div class="world-mvp__list">
          <button v-for="item in objects" :key="item.id" :class="{ active: selectedName === item.name }" @click="selectModel(objectsById.get(item.id))">{{ item.name }}</button>
        </div>
      </section>

      <section>
        <h2>校园场景</h2>
        <p class="world-mvp__message">已加载南昌工学院校园空间底图，校园建筑、道路、湖泊和公共区域作为场景环境。</p>
      </section>
      <section>
        <h2>环境</h2>
        <label class="world-mvp__field"><span>时间 <b>{{ String(Math.floor(time)).padStart(2, '0') }}:{{ String(Math.round((time % 1) * 60)).padStart(2, '0') }}</b></span>
          <input v-model.number="time" type="range" min="0" max="24" step="0.25" @input="updateEnvironment">
        </label>
        <label class="world-mvp__field"><span>天气</span>
          <select v-model="weather" @change="updateEnvironment">
            <option value="clear">晴天</option><option value="rain">下雨</option>
          </select>
        </label>
        <label class="world-mvp__field"><span>风力 <b>{{ wind }}%</b></span>
          <input v-model.number="wind" type="range" min="0" max="100" step="5">
        </label>
      </section>

      <section>
        <h2>任务交互</h2>
        <div class="world-mvp__command">
          <input v-model="command" placeholder="输入任务，例如：创建球体" @keydown.enter="executeTask">
          <button @click="executeTask">执行</button>
        </div>
        <p class="world-mvp__message">{{ message }}</p>
        <div class="world-mvp__examples">
          <button @click="command = '创建球体'; executeTask()">创建球体</button>
          <button @click="command = '移动 2,0,3'; executeTask()">移动模型</button>
          <button @click="command = '切换雨天'; executeTask()">切换雨天</button>
          <button @click="command = '触发交互'; executeTask()">触发交互</button>
        </div>
      </section>
    </aside>
    <footer class="world-mvp__help">WASD / 方向键移动人物 · 点击建模组选择 · 拖动坐标轴编辑模型</footer>
  </main>
</template>

<style scoped>
.world-mvp { position:relative; width:100%; height:100vh; min-height:600px; overflow:hidden; color:#e8efed; background:#111a20; font-family:Inter,"Microsoft YaHei",sans-serif; }
.world-mvp__viewport { position:absolute; inset:0; }
.world-mvp__viewport :deep(canvas) { display:block; width:100%; height:100%; }
.world-mvp__header { position:absolute; z-index:2; top:0; left:0; right:0; height:62px; display:flex; align-items:center; justify-content:space-between; padding:0 20px; border-bottom:1px solid rgba(255,255,255,.1); background:rgba(13,22,28,.78); backdrop-filter:blur(14px); }
.world-mvp__brand strong,.world-mvp__brand span { display:block; }
.world-mvp__brand strong { font-size:13px; letter-spacing:1.1px; }
.world-mvp__brand span { margin-top:4px; color:#8e9fa3; font-size:10px; }
.world-mvp a,.world-mvp button { border:1px solid rgba(255,255,255,.13); border-radius:7px; padding:8px 10px; color:#dce7e3; background:rgba(255,255,255,.06); text-decoration:none; cursor:pointer; font:inherit; font-size:11px; }
.world-mvp button:hover,.world-mvp a:hover { border-color:#a5c9b1; background:rgba(165,201,177,.13); }
.world-mvp button:disabled { opacity:.35; cursor:not-allowed; }
.world-mvp__panel { position:absolute; z-index:2; top:78px; left:14px; bottom:48px; width:290px; overflow:auto; padding:0 14px 14px; border:1px solid rgba(255,255,255,.1); border-radius:11px; background:rgba(16,27,34,.91); box-shadow:0 14px 42px rgba(0,0,0,.22); backdrop-filter:blur(16px); }
.world-mvp__panel section { padding:15px 0; border-bottom:1px solid rgba(255,255,255,.09); }
.world-mvp__panel h2 { margin:0 0 12px; font-size:12px; }
.world-mvp__model-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:6px; }
.world-mvp__selected { display:grid; grid-template-columns:1fr auto auto; align-items:center; gap:6px; margin-top:10px; padding:9px; border:1px solid rgba(255,255,255,.1); border-radius:7px; }
.world-mvp__selected span { color:#8e9fa3; font-size:10px; }
.world-mvp__selected strong { grid-column:1; font-size:11px; }
.world-mvp__selected button:nth-of-type(1) { grid-column:2; grid-row:1 / span 2; }.world-mvp__selected button:nth-of-type(2) { grid-column:3; grid-row:1 / span 2; }
.world-mvp__tools { display:grid; grid-template-columns:repeat(3,1fr); gap:5px; margin-top:8px; }
.world-mvp button.active { border-color:#a5c9b1; color:#c6e4ce; background:rgba(165,201,177,.16); }
.world-mvp__list { display:grid; gap:4px; max-height:100px; overflow:auto; margin-top:8px; }
.world-mvp__list button { text-align:left; }
.world-mvp__field { display:grid; gap:8px; margin:12px 0; color:#b4c1c1; font-size:11px; }
.world-mvp__field span { display:flex; justify-content:space-between; }
.world-mvp__field b { color:#e1ebe4; }
.world-mvp__field input[type=range] { width:100%; accent-color:#a5c9b1; }
.world-mvp__field select { padding:8px; border:1px solid rgba(255,255,255,.14); border-radius:7px; color:#e4ece8; background:#1b2a32; }
.world-mvp__command { display:flex; gap:6px; }
.world-mvp__command input { min-width:0; flex:1; padding:9px; border:1px solid rgba(255,255,255,.14); border-radius:7px; outline:none; color:#e8efed; background:#1a2931; font:inherit; font-size:11px; }
.world-mvp__command button { border-color:#a5c9b1; color:#14251c; background:#a5c9b1; font-weight:700; }
.world-mvp__message { min-height:34px; color:#c5d8cb; font-size:10px; line-height:1.6; }
.world-mvp__examples { display:flex; flex-wrap:wrap; gap:5px; }
.world-mvp__examples button { padding:5px 7px; font-size:9px; }
.world-mvp__help { position:absolute; right:14px; bottom:12px; padding:8px 11px; border:1px solid rgba(255,255,255,.1); border-radius:7px; color:#c7d2d0; background:rgba(16,27,34,.75); font-size:10px; }
@media(max-width:680px) {
  .world-mvp__header { height:54px; padding:0 10px; }
  .world-mvp__panel { top:auto; left:8px; right:8px; bottom:8px; width:auto; max-height:52vh; padding:0 12px 10px; }
  .world-mvp__help { display:none; }
}
</style>
