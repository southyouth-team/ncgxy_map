<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { createCampusEngine } from '../three/engine/createCampusEngine.js'
import { executeProceduralModel } from '../three/sandbox/executeProceduralModel.js'
import { createCapabilityControlDocument } from '../three/sandbox/capabilityControl.js'
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
const editorOpen = ref(false)
const editorMode = ref('edit')
const isDraftModel = ref(false)
const generationProgress = ref([])
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
const artificialLightingEnabled = ref(true)
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
function addLightSwitchDemo() {
  const player = engine?.getPlayerPosition?.() || { x: 0, z: 14 }
  const lamp = new THREE.Group()
  lamp.name = '演示灯具'
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, 0.28, 20),
    new THREE.MeshStandardMaterial({ color: '#343b42', metalness: 0.65, roughness: 0.35 }),
  )
  base.position.y = 0.14
  lamp.add(base)
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 1.5, 12),
    new THREE.MeshStandardMaterial({ color: '#69747b', metalness: 0.7, roughness: 0.3 }),
  )
  stem.position.y = 0.95
  lamp.add(stem)
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 20, 16),
    new THREE.MeshStandardMaterial({
      color: '#fff0b5',
      emissive: '#ffd36a',
      emissiveIntensity: 1.4,
      roughness: 0.25,
    }),
  )
  bulb.position.y = 1.9
  bulb.userData.stateBinding = { key: 'enabled', property: 'emissiveIntensity', enabledValue: 1.4 }
  lamp.add(bulb)
  const pointLight = new THREE.PointLight('#ffd98a', 2.2, 11, 1.8)
  pointLight.position.set(0, 1.9, 0)
  pointLight.castShadow = true
  pointLight.userData.stateBinding = { key: 'enabled', property: 'visible' }
  lamp.add(pointLight)
  lamp.userData.worldState = { enabled: true }
  const lampPosition = { x: player.x + 5, y: 0, z: player.z + 2 }
  const lampRoot = registerModel(lamp, '演示灯具', lampPosition)

  const switchRoot = new THREE.Group()
  switchRoot.name = '墙壁开关'
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 1.05, 0.12),
    new THREE.MeshStandardMaterial({ color: '#e7e5dc', roughness: 0.55 }),
  )
  plate.position.y = 1.2
  switchRoot.add(plate)
  const button = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.38, 0.1),
    new THREE.MeshStandardMaterial({ color: '#b7c6c0', roughness: 0.35 }),
  )
  button.position.set(0, 1.2, 0.11)
  switchRoot.add(button)
  switchRoot.userData.interactionRadius = 4.8
  switchRoot.userData.interactionConfig = {
    action: 'toggle-state',
    targetId: lampRoot.userData.sandboxModelId,
    stateKey: 'enabled',
    prompt: '靠近墙壁开关，按 E 切换演示灯具',
  }
  switchRoot.userData.interactionMessage = '你按下了墙壁开关'
  const switchPosition = { x: player.x + 2, y: 0, z: player.z + 2 }
  registerModel(switchRoot, '墙壁开关', switchPosition)
  message.value = '已创建灯具与墙壁开关演示。靠近开关按 E，验证灯具亮灭。'
  saveStatus.value = '未保存演示场景'
}

function handleSandboxModelInteract(payload) {
  const source = payload?.id ? objectsById.get(payload.id) : null
  const config = payload?.config || source?.userData?.interactionConfig
  if (config?.action === 'toggle-state' && config.stateKey) {
    const targetId = String(config.targetId || payload.id || '')
    const current = targetId ? engine?.getSandboxModelState?.(targetId) : null
    if (!current) {
      message.value = '交互目标不存在，无法切换状态'
      return
    }
    const nextValue = !Boolean(current[config.stateKey])
    const next = engine.setSandboxModelState(targetId, { [config.stateKey]: nextValue })
    const defaultOn = config.stateKey === 'doorOpen' ? '门已打开' : '状态已开启'
    const defaultOff = config.stateKey === 'doorOpen' ? '门已关闭' : '状态已关闭'
    message.value = next
      ? (nextValue ? (config.openMessage || defaultOn) : (config.closeMessage || defaultOff))
      : '交互状态更新失败'
    saveStatus.value = '状态已变更，记得保存'
    return
  }
  message.value = payload?.message || ('已与 ' + (payload?.name || '模型') + ' 交互')
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
function updateGenerationProgress(event) {
  const next = [...generationProgress.value]
  const index = next.findIndex(item => item.stage === event.stage)
  for (let i = 0; i < next.length; i++) {
    if (next[i].status === 'active') next[i] = { ...next[i], status: 'done' }
  }
  const entry = {
    stage: event.stage,
    label: event.label || event.stage,
    detail: event.detail || '',
    status: 'active',
  }
  if (index >= 0) next[index] = entry
  else next.push(entry)
  generationProgress.value = next
}

function buildCompositeComponentSource(plan, chunks) {
  const manifest = plan?.modelCapabilityManifest && typeof plan.modelCapabilityManifest === 'object'
    ? plan.modelCapabilityManifest : { version: 1, parameters: [], capabilities: {} }
  const parts = Array.isArray(plan?.components) ? plan.components : []
  const declarations = ['const __buildPlan = ' + JSON.stringify(plan) + ';']
  const builders = chunks.map((entry, index) => {
    const component = parts.find(item => item.id === entry.componentId) || { id: entry.componentId }
    const completedDependencies = chunks.slice(0, index).map(item => ({
      componentId: item.componentId,
      purpose: String(parts.find(part => part.id === item.componentId)?.purpose || item.componentId),
    }))
    const source = String(entry.source || '').replace(/^\s*export\s+function\s+createComponent/, 'function createComponent')
    if (!/^\s*function\s+createComponent\s*\(\s*THREE\s*,/.test(source)) {
      throw new Error('组件 ' + entry.componentId + ' 的源码工厂格式无效')
    }
    if (source.length > 30000) throw new Error('组件 ' + entry.componentId + ' 源码超过 30 KB')
    return [
      '{',
      source,
      'const __part = createComponent(THREE, { plan: __buildPlan, component: ' + JSON.stringify(component)
        + ', completedDependencies: ' + JSON.stringify(completedDependencies) + ', params });',
      'if (!__part || __part.isGroup !== true) throw new Error(' + JSON.stringify('组件 ' + entry.componentId + ' 必须返回 THREE.Group') + ');',
      '__part.userData = { ...( __part.userData || {}), componentId: ' + JSON.stringify(entry.componentId) + ' };',
      'root.add(__part);',
      '}',
    ].join('\n')
  })
  const source = [
    ...declarations,
    'export function createModel(THREE, params = {}) {',
    'const root = new THREE.Group();',
    ...builders,
    'root.name = ' + JSON.stringify(plan?.name || 'AI 程序化模型') + ';',
    'root.userData = { ...(root.userData || {}), assetName: root.name, proceduralModelCapabilityManifest: '
      + JSON.stringify(manifest) + ', proceduralModelParameters: '
      + JSON.stringify(Array.isArray(manifest.parameters) ? manifest.parameters : []) + ', proceduralModelParts: '
      + JSON.stringify(parts.map(item => ({ id: item.id, name: item.name || item.purpose || item.id })))
      + ', proceduralModelEnvironmentBindings: '
      + JSON.stringify(Array.isArray(manifest.capabilities?.environmentBindings) ? manifest.capabilities.environmentBindings : []) + ' };',
    'return root;',
    '}',
  ].join('\n')
  if (source.length > 120000) throw new Error('累计模型源码超过 120 KB，请减少组件细节或拆分为更精简的部件')
  return source
}

async function generateAiModel() {
  const prompt = aiPrompt.value.trim()
  if ((!prompt && !referenceImageDataUrl.value) || aiBusy.value) return

  aiBusy.value = true
  editorOpen.value = true
  editorMode.value = 'create'
  isDraftModel.value = true
  editingModel.value = null
  editHistory.value = []
  editError.value = ''
  generationProgress.value = [{
    stage: 'request',
    label: '请求 AI 规划模型',
    detail: '正在提交描述与参考图，AI 将根据结构复杂度选择生成策略',
    status: 'active',
  }]
  message.value = '正在规划并生成 Three.js 程序化模型…'

  try {
    const response = await fetch(API_BASE + '/assets/ai-image/generate-procedural-object-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({
        prompt,
        objectType: '独立 3D 模型',
        visualStyle: 'stylized',
        imageDataUrl: referenceImageDataUrl.value || undefined,
      }),
    })
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.message || '增量模型生成失败：HTTP ' + response.status)
    }

    let buffer = ''
    let plan = null
    let result = null
    const chunks = []
    let completed = false
    const decoder = new TextDecoder()
    const processEvent = async event => {
      if (!event || typeof event.type !== 'string') return
      if (event.type === 'stage') {
        updateGenerationProgress({ stage: event.stage, label: event.label || event.stage })
        return
      }
      if (event.type === 'plan') {
        plan = event.plan
        updateGenerationProgress({
          stage: 'plan-ready',
          label: '模型结构规划完成',
          detail: '共 ' + (plan?.components?.length || 0) + ' 个组件，已确定共享坐标系和依赖关系',
        })
        return
      }
      if (event.type === 'component-start') {
        updateGenerationProgress({
          stage: 'component-' + event.componentId,
          label: '生成组件 ' + (Number(event.index) + 1) + '/' + event.total,
          detail: event.componentId,
        })
        return
      }
      if (event.type === 'component-complete') {
        if (!plan || !event.chunk?.source) throw new Error('组件事件缺少 ModelPlan 或组件源码')
        chunks.push(event.chunk)
        const compositeSource = buildCompositeComponentSource(plan, chunks)
        updateGenerationProgress({
          stage: 'worker-component-' + event.componentId,
          label: '构建并预览组件 ' + chunks.length + '/' + event.total,
          detail: '组件源码已完整返回，正在隔离 Worker 中重建当前有效模型',
        })
        const group = await executeProceduralModel(compositeSource, {
          timeoutMs: 60000,
          onProgress: updateGenerationProgress,
        })
        group.userData.proceduralModelSource = compositeSource
        group.userData.proceduralModelBuildPlan = plan
        group.userData.proceduralModelBuildChunks = chunks.map(item => ({
          componentId: item.componentId,
          source: item.source,
        }))
        group.userData.proceduralModelConfig = {
          protocol: 'threejs-procedural-build-v1',
          generator: 'img2threejs-procedural-components',
          objectType: '独立 3D 模型',
          visualStyle: 'stylized',
          prompt,
          hasReferenceImage: Boolean(referenceImageDataUrl.value),
          generatedAt: new Date().toISOString(),
        }
        group.userData.interactionRadius = Number(group.userData.interactionRadius) || 4.5
        editingModel.value = group
        return
      }
      if (event.type === 'single') {
        result = event.result
        return
      }
      if (event.type === 'assembly') {
        updateGenerationProgress({
          stage: 'assembly-' + event.status,
          label: event.status === 'started' ? '整合完整模型' : '模型整合完成',
        })
        return
      }
      if (event.type === 'error') {
        throw new Error(event.message || '模型构建失败')
      }
      if (event.type === 'complete') {
        completed = true
      }
    }

    const reader = response.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) await processEvent(JSON.parse(line))
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) await processEvent(JSON.parse(buffer.trim()))
    if (!completed) throw new Error('模型构建事件流提前结束，未收到 complete 事件')

    if (result) {
      updateGenerationProgress({ stage: 'worker-start', label: '启动隔离建模 Worker', detail: '一次性模型源码已返回' })
      const group = await executeProceduralModel(result.generatedCode, {
        timeoutMs: 60000,
        onProgress: updateGenerationProgress,
      })
      group.userData.proceduralModelParameterValues = modelParameterDefaults(group.userData.proceduralModelParameters || [])
      group.userData.proceduralModelConfig = {
        protocol: 'threejs-procedural-v1',
        generator: result.generationMethod || 'img2threejs-procedural',
        objectType: result.objectType || '独立 3D 模型',
        visualStyle: result.visualStyle || 'stylized',
        prompt,
        hasReferenceImage: Boolean(referenceImageDataUrl.value),
        generatedAt: result.generatedAt || new Date().toISOString(),
      }
      group.userData.proceduralModelSource = result.generatedCode
      group.userData.interactionRadius = Number(group.userData.interactionRadius) || 4.5
      editingModel.value = group
    }

    const model = editingModel.value
    if (!model) throw new Error('构建完成但没有可预览的模型')
    model.userData.proceduralModelParameterValues = modelParameterDefaults(model.userData.proceduralModelParameters || [])
    model.userData.proceduralModelParts = Array.isArray(model.userData.proceduralModelParts)
      ? model.userData.proceduralModelParts : []
    model.userData.proceduralModelEnvironmentBindings = Array.isArray(model.userData.proceduralModelEnvironmentBindings)
      ? model.userData.proceduralModelEnvironmentBindings : []
    model.userData.proceduralModelCapabilityManifest = model.userData.proceduralModelCapabilityManifest
      && typeof model.userData.proceduralModelCapabilityManifest === 'object'
      ? model.userData.proceduralModelCapabilityManifest
      : { version: 1, parameters: model.userData.proceduralModelParameters, capabilities: {} }
    model.name = model.userData.assetName || plan?.name || result?.objectType || 'AI 程序化模型'
    generationProgress.value = generationProgress.value.map(item => ({ ...item, status: 'done' }))
    generationProgress.value.push({
      stage: 'preview-ready',
      label: '模型预览已就绪',
      detail: '已获得可编辑的 Three.js 模型；尚未加入沙盒，等待用户保存',
      status: 'done',
    })
    message.value = '模型生成完成，可继续调整参数或通过 AI 对话编辑；保存后才会加入沙盒。'
  } catch (error) {
    const next = [...generationProgress.value]
    const activeIndex = next.findIndex(item => item.status === 'active')
    if (activeIndex >= 0) next[activeIndex] = { ...next[activeIndex], status: 'failed', detail: error?.message || '未知错误' }
    else next.push({ stage: 'failed', label: '模型生成失败', detail: error?.message || '未知错误', status: 'failed' })
    generationProgress.value = next
    editError.value = error?.message || '未知错误'
    message.value = 'AI 程序化建模失败：' + editError.value
  } finally {
    aiBusy.value = false
  }
}

function handleCapabilityChange(payload) {
  const model = editingModel.value
  if (!model || !payload?.capabilityId || !payload?.targetPartId) return
  const document = model.userData.proceduralModelCapabilityControlDocument
    || createCapabilityControlDocument({ manifest: model.userData.proceduralModelCapabilityManifest })
  const scope = { targetType: 'part', targetId: String(payload.targetPartId) }
  const overrides = [...(document.overrides || [])]
  const index = overrides.findIndex(record =>
    record?.capabilityId === payload.capabilityId &&
    record.scope?.targetType === scope.targetType &&
    String(record.scope?.targetId || '') === scope.targetId)
  const nextOverride = {
    capabilityId: payload.capabilityId,
    scope,
    action: 'set',
    value: { blocksMovement: Boolean(payload.blocksMovement) },
    updatedAt: new Date().toISOString(),
  }
  if (index >= 0) overrides[index] = nextOverride
  else overrides.push(nextOverride)
  model.userData.proceduralModelCapabilityControlDocument = {
    ...document,
    overrides,
  }
  const updated = isDraftModel.value ? true : engine?.refreshSandboxModelSpatial?.(model)
  message.value = payload.blocksMovement
    ? '已启用该部件的玩家移动阻挡'
    : '已关闭该部件的玩家移动阻挡'
  if (updated === undefined) message.value += '（碰撞 Runtime 刷新接口不可用）'
  saveStatus.value = '能力已调整，记得保存沙盒'
}

function openModelEditor(payload) {
  const model = payload?.id ? engine?.getSandboxModel(payload.id) : selected
  if (!model?.userData?.proceduralModelSource) {
    message.value = '该模型没有可编辑的 AI 程序化源码'
    return
  }
  editingModel.value = model
  editorOpen.value = true
  editorMode.value = 'edit'
  isDraftModel.value = false
  editHistory.value = []
  editError.value = ''
}

function closeModelEditor() {
  editorOpen.value = false
  editingModel.value = null
  if (isDraftModel.value) {
    isDraftModel.value = false
    message.value = '已取消创建，模型未加入沙盒'
  }
}

function saveEditorModel() {
  const model = editingModel.value
  if (!model) return
  const wasDraft = isDraftModel.value
  if (wasDraft) {
    const name = model.userData?.assetName || model.name || 'AI 程序化模型'
    registerModel(model, name + ' ' + (objects.value.length + 1))
    isDraftModel.value = false
    aiPrompt.value = ''
    referenceImageDataUrl.value = ''
    referenceImageName.value = ''
  }
  const persisted = saveSandbox()
  if (!persisted) {
    message.value = wasDraft
      ? '模型已加入当前沙盒，但存档失败；请检查存储空间后重试保存'
      : '模型修改已应用到当前沙盒，但存档失败；请检查存储空间后重试保存'
    return
  }
  editorOpen.value = false
  editingModel.value = null
  message.value = wasDraft ? '模型已加入沙盒并保存存档' : '模型修改已保存到沙盒存档'
}
function modelParameterDefaults(definitions, existing = {}) {
  const values = { ...(existing || {}) }
  for (const item of definitions || []) {
    if (item?.id && values[item.id] === undefined && item.default !== undefined) values[item.id] = item.default
  }
  return values
}
async function replaceEditedModel(source, values, definitions, parts, summary = '模型已更新', recordHistory = true, environmentBindings = null, modelCapabilityManifest = null, capabilityControlDocument = null) {
  const current = editingModel.value
  if (!current) throw new Error('当前没有正在编辑的模型')
  const id = current.userData.sandboxModelId
  const previousCapabilityControlDocument = capabilityControlDocument
    || current.userData.proceduralModelCapabilityControlDocument || null
  let replacement = await executeProceduralModel(source, {
    timeoutMs: 60000,
    parameters: values,
    capabilityControlDocument: previousCapabilityControlDocument,
  })
  const moduleDefinitions = Array.isArray(replacement.userData?.proceduralModelParameters) ? replacement.userData.proceduralModelParameters : []
  const moduleParts = Array.isArray(replacement.userData?.proceduralModelParts) ? replacement.userData.proceduralModelParts : []
  const moduleEnvironmentBindings = Array.isArray(replacement.userData?.proceduralModelEnvironmentBindings)
    ? replacement.userData.proceduralModelEnvironmentBindings : []
  const moduleCapabilityManifest = replacement.userData?.proceduralModelCapabilityManifest
    && typeof replacement.userData.proceduralModelCapabilityManifest === 'object'
    ? replacement.userData.proceduralModelCapabilityManifest : null
  const resolvedCapabilityManifest = modelCapabilityManifest && typeof modelCapabilityManifest === 'object'
    ? modelCapabilityManifest
    : (current.userData.proceduralModelCapabilityManifest || moduleCapabilityManifest || null)
  const manifestCapabilities = resolvedCapabilityManifest?.capabilities && typeof resolvedCapabilityManifest.capabilities === 'object'
    ? resolvedCapabilityManifest.capabilities : {}
  const resolvedDefinitions = Array.isArray(resolvedCapabilityManifest?.parameters)
    ? resolvedCapabilityManifest.parameters
    : (Array.isArray(definitions) && definitions.length ? definitions : moduleDefinitions)
  const resolvedParts = Array.isArray(parts) && parts.length ? parts : moduleParts
  const resolvedEnvironmentBindings = Array.isArray(manifestCapabilities.environmentBindings)
    ? manifestCapabilities.environmentBindings
    : (Array.isArray(environmentBindings)
      ? environmentBindings
      : (moduleEnvironmentBindings.length ? moduleEnvironmentBindings : (current.userData.proceduralModelEnvironmentBindings || [])))
  const finalCapabilityManifest = resolvedCapabilityManifest || {
    version: 1,
    parameters: resolvedDefinitions,
    capabilities: resolvedEnvironmentBindings.length ? { environmentBindings: resolvedEnvironmentBindings } : {},
  }
  const resolvedValues = modelParameterDefaults(resolvedDefinitions, values)
  if (JSON.stringify(resolvedValues) !== JSON.stringify(values || {})) {
    replacement = await executeProceduralModel(source, {
      timeoutMs: 60000,
      parameters: resolvedValues,
      capabilityControlDocument: previousCapabilityControlDocument,
    })
  }
  replacement.userData = {
    ...(replacement.userData || {}),
    proceduralModelSource: source,
    proceduralModelParameters: resolvedDefinitions,
    proceduralModelParts: resolvedParts,
    proceduralModelEnvironmentBindings: resolvedEnvironmentBindings,
    proceduralModelCapabilityManifest: finalCapabilityManifest,
    proceduralModelCapabilityControlDocument: replacement.userData.proceduralModelCapabilityControlDocument
      || createCapabilityControlDocument({ manifest: finalCapabilityManifest, previousDocument: previousCapabilityControlDocument }),
    proceduralModelParameterValues: resolvedValues,
    worldState: { ...(current.userData.worldState || {}) },
    environmentOverrides: { ...(current.userData.environmentOverrides || {}) },
    proceduralModelConfig: { ...(current.userData.proceduralModelConfig || {}), updatedAt: new Date().toISOString() },
    interactionRadius: Number(current.userData.interactionRadius) || 4.5,
  }
  replacement.name = current.name
  if (isDraftModel.value) {
    replacement.position.copy(current.position)
    replacement.quaternion.copy(current.quaternion)
    replacement.scale.copy(current.scale)
    replacement.updateMatrixWorld(true)
  } else if (!engine.replaceSandboxModel(id, replacement, { name: current.name })) {
    throw new Error('模型替换失败，原模型已保留')
  }
  if (recordHistory) {
    editHistory.value.push({
      source: current.userData.proceduralModelSource,
      values: { ...(current.userData.proceduralModelParameterValues || {}) },
      definitions: current.userData.proceduralModelParameters || [],
      parts: current.userData.proceduralModelParts || [],
      environmentBindings: current.userData.proceduralModelEnvironmentBindings || [],
      modelCapabilityManifest: current.userData.proceduralModelCapabilityManifest || null,
      capabilityControlDocument: current.userData.proceduralModelCapabilityControlDocument || null,
    })
    if (editHistory.value.length > 10) editHistory.value.shift()
  }
  if (id) {
    objectsById.set(id, replacement)
    selected = replacement
  }
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
        environmentBindings: current.userData.proceduralModelEnvironmentBindings || [],
        modelCapabilityManifest: current.userData.proceduralModelCapabilityManifest || null,
        geometryDiagnostics: current.userData.proceduralModelGeometryDiagnostics || null,
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
    await replaceEditedModel(result.generatedCode, values, definitions, parts, result.changeSummary || 'AI 已完成模型调整', true, result.environmentBindings, result.modelCapabilityManifest)
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
    await replaceEditedModel(snapshot.source, snapshot.values, snapshot.definitions, snapshot.parts, '已恢复上一版本', false, snapshot.environmentBindings, snapshot.modelCapabilityManifest, snapshot.capabilityControlDocument)
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
  if (!engine) return false
  try {
    const models = Array.from(objectsById.entries()).map(([id, model]) => ({
      id,
      name: model.name,
      object: model.toJSON(),
    }))
    const snapshot = {
      version: 3,
      savedAt: new Date().toISOString(),
      environment: {
        time: Number(time.value),
        timeEnabled: timeEnabled.value,
        weather: weather.value,
        weatherEnabled: weatherEnabled.value,
        rainEnabled: rainEnabled.value,
        wind: Number(wind.value),
        windEnabled: windEnabled.value,
        artificialLightingEnabled: artificialLightingEnabled.value,
      },
      selectedModelId: selected?.userData?.sandboxModelId || null,
      models,
    }
    const serialized = JSON.stringify(snapshot)
    localStorage.setItem(STORAGE_KEY, serialized)
    saveStatus.value = '已保存 · ' + new Date(snapshot.savedAt).toLocaleTimeString()
    message.value = '沙盒已保存，刷新页面后会自动恢复'
    return true
  } catch (error) {
    const reason = error?.name === 'QuotaExceededError' ? '浏览器本地存储空间不足' : (error?.message || '未知错误')
    saveStatus.value = '保存失败'
    message.value = '沙盒保存失败：' + reason
    return false
  }
}

async function restoreSandbox() {
  let snapshot
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    snapshot = JSON.parse(raw)
    if (![1, 2, 3].includes(snapshot?.version) || !Array.isArray(snapshot.models)) throw new Error('保存文件版本不兼容')
    const loader = new THREE.ObjectLoader()
    for (const item of snapshot.models) {
      if (!item?.object || !item?.id) continue
      const model = loader.parse(item.object)
      model.name = item.name || model.name || '已保存模型'
      model.userData = {
        ...(model.userData || {}),
        proceduralModelCapabilityControlDocument: model.userData?.proceduralModelCapabilityControlDocument
          || createCapabilityControlDocument({ manifest: model.userData?.proceduralModelCapabilityManifest }),
      }
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
      artificialLightingEnabled.value = snapshot.environment.artificialLightingEnabled !== false
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
    artificialLightingEnabled: artificialLightingEnabled.value,
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
      onSandboxModelInteract: handleSandboxModelInteract,
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
        <button class="world-mvp__demo-button" @click="addLightSwitchDemo">创建开关灯交互演示</button>
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
        <label class="world-mvp__toggle"><input v-model="artificialLightingEnabled" type="checkbox" @change="updateEnvironment"><span>人工灯光总开关</span><b>{{ artificialLightingEnabled ? '开启' : '关闭' }}</b></label>
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
      v-if="editorOpen"
      :model="editingModel"
      :mode="editorMode"
      :progress="generationProgress"
      :busy="aiBusy || editBusy"
      :error="editError"
      :can-undo="editHistory.length > 0"
      @undo="undoModelEdit"
      @close="closeModelEditor"
      @save="saveEditorModel"
      @edit="handleModelEdit"
      @parameter-change="handleParameterChange"
      @capability-change="handleCapabilityChange"
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
.world-mvp .world-mvp__demo-button { width:100%; margin-top:7px; border-color:rgba(165,201,177,.45); color:#c6e4ce; }
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
