<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { createCampusEngine } from '../three/engine/createCampusEngine.js'
import { executeProceduralModel } from '../three/sandbox/executeProceduralModel.js'
import ProceduralModelEditor from './ProceduralModelEditor.vue'

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
const editingModel = ref(null)
const editBusy = ref(false)
const editError = ref('')
const editHistory = ref([])
const message = ref('正在初始化 RPG 校园场景…')
const saveStatus = ref('尚未保存')
const STORAGE_KEY = 'world-sandbox-mvp:workspace:v1'
const time = ref(14)
const timeEnabled = ref(true)
const weather = ref('clear')
const weatherEnabled = ref(true)
const rainEnabled = ref(true)
const wind = ref(20)
const windEnabled = ref(true)
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
    const group = await executeProceduralModel(result.generatedCode, { timeoutMs: 60000 })
    const modelName = group.userData.assetName || result.objectType || 'AI 程序化模型'
    const modelParameters = Array.isArray(group.userData.proceduralModelParameters) ? group.userData.proceduralModelParameters : []
    group.userData.proceduralModelParameterValues = modelParameterDefaults(modelParameters)
    group.userData.proceduralModelParts = Array.isArray(group.userData.proceduralModelParts) ? group.userData.proceduralModelParts : []
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

function openModelEditor(payload) {
  const model = payload?.id ? engine?.getSandboxModel(payload.id) : selected
  if (!model?.userData?.proceduralModelSource) {
    message.value = '该模型没有可编辑的 AI 程序化源码'
    return
  }
  editingModel.value = model
  editHistory.value = []
  editError.value = ''
}
function modelParameterDefaults(definitions, existing = {}) {
  const values = { ...(existing || {}) }
  for (const item of definitions || []) {
    if (item?.id && values[item.id] === undefined && item.default !== undefined) values[item.id] = item.default
  }
  return values
}
async function replaceEditedModel(source, values, definitions, parts, summary = '模型已更新', recordHistory = true) {
  const current = editingModel.value
  if (!current) throw new Error('当前没有正在编辑的模型')
  const id = current.userData.sandboxModelId
  let replacement = await executeProceduralModel(source, { timeoutMs: 60000, parameters: values })
  const moduleDefinitions = Array.isArray(replacement.userData?.proceduralModelParameters) ? replacement.userData.proceduralModelParameters : []
  const moduleParts = Array.isArray(replacement.userData?.proceduralModelParts) ? replacement.userData.proceduralModelParts : []
  const resolvedDefinitions = Array.isArray(definitions) && definitions.length ? definitions : moduleDefinitions
  const resolvedParts = Array.isArray(parts) && parts.length ? parts : moduleParts
  const resolvedValues = modelParameterDefaults(resolvedDefinitions, values)
  if (JSON.stringify(resolvedValues) !== JSON.stringify(values || {})) {
    replacement = await executeProceduralModel(source, { timeoutMs: 60000, parameters: resolvedValues })
  }
  replacement.userData = {
    ...(replacement.userData || {}),
    proceduralModelSource: source,
    proceduralModelParameters: resolvedDefinitions,
    proceduralModelParts: resolvedParts,
    proceduralModelParameterValues: resolvedValues,
    proceduralModelConfig: { ...(current.userData.proceduralModelConfig || {}), updatedAt: new Date().toISOString() },
    interactionRadius: Number(current.userData.interactionRadius) || 4.5,
  }
  replacement.name = current.name
  if (!engine.replaceSandboxModel(id, replacement, { name: current.name })) throw new Error('模型替换失败，原模型已保留')
  if (recordHistory) {
    editHistory.value.push({
      source: current.userData.proceduralModelSource,
      values: { ...(current.userData.proceduralModelParameterValues || {}) },
      definitions: current.userData.proceduralModelParameters || [],
      parts: current.userData.proceduralModelParts || [],
    })
    if (editHistory.value.length > 10) editHistory.value.shift()
  }
  objectsById.set(id, replacement)
  selected = replacement
  editingModel.value = replacement
  syncObjects()
  message.value = summary
}
async function handleModelEdit(payload) {
  const current = editingModel.value
  if (!current || editBusy.value) return
  const source = current.userData.proceduralModelSource
  const values = { ...(current.userData.proceduralModelParameterValues || {}), ...(payload?.parameterValues || {}) }
  editBusy.value = true
  editError.value = ''
  try {
    const response = await fetch(API_BASE + '/assets/ai-image/modify-procedural-object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({
        source,
        parameters: current.userData.proceduralModelParameters || [],
        parameterValues: values,
        parts: current.userData.proceduralModelParts || [],
        selectedPartId: payload?.selectedPartId || '',
        instruction: payload?.instruction || '',
        objectType: current.userData.proceduralModelConfig?.objectType || '独立 3D 模型',
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.message || 'AI 模型编辑失败：HTTP ' + response.status)
    const result = body.data || body.result || body
    const definitions = Array.isArray(result.parameters) ? result.parameters : (Array.isArray(result.modelParameters) ? result.modelParameters : [])
    const parts = Array.isArray(result.parts) ? result.parts : (Array.isArray(result.modelParts) ? result.modelParts : [])
    await replaceEditedModel(result.generatedCode, values, definitions, parts, result.changeSummary || 'AI 已完成模型调整')
  } catch (error) {
    editError.value = error?.message || '模型调整失败'
  } finally {
    editBusy.value = false
  }
}

async function undoModelEdit() {
  const snapshot = editHistory.value.pop()
  if (!snapshot || !editingModel.value || editBusy.value) return
  editBusy.value = true
  editError.value = ''
  try {
    await replaceEditedModel(snapshot.source, snapshot.values, snapshot.definitions, snapshot.parts, '已恢复上一版本', false)
  } catch (error) {
    editHistory.value.push(snapshot)
    editError.value = error?.message || '恢复失败'
  } finally {
    editBusy.value = false
  }
}

async function handleParameterChange(payload) {
  const current = editingModel.value
  if (!current || editBusy.value || !payload?.id) return
  const values = { ...(current.userData.proceduralModelParameterValues || {}), [payload.id]: payload.value }
  editBusy.value = true
  editError.value = ''
  try {
    await replaceEditedModel(
      current.userData.proceduralModelSource,
      values,
      current.userData.proceduralModelParameters || [],
      current.userData.proceduralModelParts || [],
      '参数已更新',
    )
  } catch (error) {
    editError.value = error?.message || '参数更新失败'
  } finally {
    editBusy.value = false
  }
}

function saveSandbox() {
  if (!engine) return
  try {
    const models = Array.from(objectsById.entries()).map(([id, model]) => ({
      id,
      name: model.name,
      object: model.toJSON(),
    }))
    const snapshot = {
      version: 2,
      savedAt: new Date().toISOString(),
      environment: {
        time: Number(time.value),
        timeEnabled: timeEnabled.value,
        weather: weather.value,
        weatherEnabled: weatherEnabled.value,
        rainEnabled: rainEnabled.value,
        wind: Number(wind.value),
        windEnabled: windEnabled.value,
      },
      selectedModelId: selected?.userData?.sandboxModelId || null,
      models,
    }
    const serialized = JSON.stringify(snapshot)
    localStorage.setItem(STORAGE_KEY, serialized)
    saveStatus.value = '已保存 · ' + new Date(snapshot.savedAt).toLocaleTimeString()
    message.value = '沙盒已保存，刷新页面后会自动恢复'
  } catch (error) {
    const reason = error?.name === 'QuotaExceededError' ? '浏览器本地存储空间不足' : (error?.message || '未知错误')
    saveStatus.value = '保存失败'
    message.value = '沙盒保存失败：' + reason
  }
}

async function restoreSandbox() {
  let snapshot
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    snapshot = JSON.parse(raw)
    if (![1, 2].includes(snapshot?.version) || !Array.isArray(snapshot.models)) throw new Error('保存文件版本不兼容')
    const loader = new THREE.ObjectLoader()
    for (const item of snapshot.models) {
      if (!item?.object || !item?.id) continue
      const model = loader.parse(item.object)
      model.name = item.name || model.name || '已保存模型'
      const id = engine.addSandboxModel(model, { name: model.name, id: item.id })
      objectsById.set(id, model)
    }
    if (snapshot.environment) {
      time.value = Number.isFinite(Number(snapshot.environment.time)) ? Number(snapshot.environment.time) : 14
      timeEnabled.value = snapshot.environment.timeEnabled !== false
      weather.value = snapshot.environment.weather === 'rain' ? 'rain' : 'clear'
      weatherEnabled.value = snapshot.environment.weatherEnabled !== false
      rainEnabled.value = snapshot.environment.rainEnabled !== false
      wind.value = Number.isFinite(Number(snapshot.environment.wind)) ? Number(snapshot.environment.wind) : 20
      windEnabled.value = snapshot.environment.windEnabled !== false
      updateEnvironment()
    }
    if (snapshot.selectedModelId && objectsById.has(snapshot.selectedModelId)) {
      selected = objectsById.get(snapshot.selectedModelId)
      engine.selectSandboxModel(snapshot.selectedModelId)
    }
    syncObjects()
    saveStatus.value = snapshot.savedAt ? '上次保存 · ' + new Date(snapshot.savedAt).toLocaleString() : '已恢复本地场景'
    message.value = '已恢复上次保存的沙盒场景，共 ' + objectsById.size + ' 个模型'
    return true
  } catch (error) {
    saveStatus.value = '恢复失败'
    message.value = '本地沙盒恢复失败：' + (error?.message || '保存数据可能已损坏')
    return false
  }
}

function updateEnvironment() {
  if (!engine) return
  engine.setEnvironment({
    // MVP 环境开关由世界配置持有；这里仅把有效值适配到现有 Three.js Runtime。
    // 关闭时间系统时保留当前小时，关闭天气/降雨时不创建雨效，关闭风力时风速归零。
    time: Number(time.value),
    weather: weatherEnabled.value && rainEnabled.value && weather.value === 'rain' ? 'rain' : 'clear',
    wind: windEnabled.value ? Number(wind.value) / 100 : 0,
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
    if (!timeEnabled.value) {
      message.value = '时间系统已关闭，请先启用后再调整时间'
    } else {
      const hour = Number(text.match(/(?:时间|time)[^0-9]*(\d{1,2})/i)[1])
      time.value = Math.min(24, Math.max(0, hour))
      updateEnvironment()
      message.value = '时间已调整为 ' + time.value + ':00'
    }
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
      onSandboxModelDoubleClick: openModelEditor,
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
    const restored = await restoreSandbox()
    if (!restored) {
      updateEnvironment()
      syncObjects()
    }
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
      <div class="world-mvp__header-actions"><span class="world-mvp__save-status">{{ saveStatus }}</span><button class="world-mvp__save-button" @click="saveSandbox">保存沙盒</button><a href="/">返回地图</a></div>
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
        <label class="world-mvp__toggle"><input v-model="timeEnabled" type="checkbox" @change="updateEnvironment"><span>时间系统</span><b>{{ timeEnabled ? '开启' : '关闭' }}</b></label>
        <label class="world-mvp__field"><span>当前时间 <b>{{ String(Math.floor(time)).padStart(2, '0') }}:{{ String(Math.round((time % 1) * 60)).padStart(2, '0') }}</b></span>
          <input v-model.number="time" type="range" min="0" max="24" step="0.25" :disabled="!timeEnabled" @input="updateEnvironment">
        </label>
        <label class="world-mvp__toggle"><input v-model="weatherEnabled" type="checkbox" @change="updateEnvironment"><span>天气总开关</span><b>{{ weatherEnabled ? '开启' : '关闭' }}</b></label>
        <label class="world-mvp__field"><span>天气模式</span>
          <select v-model="weather" :disabled="!weatherEnabled" @change="updateEnvironment">
            <option value="clear">晴天</option><option value="rain">下雨</option>
          </select>
        </label>
        <label class="world-mvp__toggle"><input v-model="rainEnabled" type="checkbox" :disabled="!weatherEnabled" @change="updateEnvironment"><span>降雨效果</span><b>{{ rainEnabled ? '开启' : '关闭' }}</b></label>
        <label class="world-mvp__toggle"><input v-model="windEnabled" type="checkbox" @change="updateEnvironment"><span>风力系统</span><b>{{ windEnabled ? '开启' : '关闭' }}</b></label>
        <label class="world-mvp__field"><span>风速 <b>{{ wind }}%</b></span>
          <input v-model.number="wind" type="range" min="0" max="100" step="5" :disabled="!windEnabled" @input="updateEnvironment">
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
    <ProceduralModelEditor
      v-if="editingModel"
      :model="editingModel"
      :busy="editBusy"
      :error="editError"
      :can-undo="editHistory.length > 0"
      @undo="undoModelEdit"
      @close="editingModel = null"
      @edit="handleModelEdit"
      @parameter-change="handleParameterChange"
    />
    <footer class="world-mvp__help">WASD / 方向键移动人物 · 点击建模组选择 · 双击 AI 模型打开微调编辑器 · 拖动坐标轴编辑模型</footer>
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
.world-mvp__header-actions { display:flex; align-items:center; gap:9px; }
.world-mvp__save-status { color:#a9bbb3; font-size:10px; }
.world-mvp .world-mvp__save-button { border-color:#8fbea0; color:#14251c; background:#a5c9b1; font-weight:700; }
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
.world-mvp__toggle { display:flex; align-items:center; gap:8px; margin:10px 0; color:#b4c1c1; font-size:11px; }
.world-mvp__toggle input { accent-color:#a5c9b1; }
.world-mvp__toggle b { margin-left:auto; color:#e1ebe4; font-size:10px; font-weight:500; }
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
