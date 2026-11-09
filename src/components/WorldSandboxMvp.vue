<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import * as THREE from 'three'
import { createCampusEngine } from '../three/engine/createCampusEngine.js'
import { executeProceduralModel } from '../three/sandbox/executeProceduralModel.js'
import { createCapabilityControlDocument } from '../three/sandbox/capabilityControl.js'
import { resolveProceduralModelParts } from '../three/sandbox/modelCapabilityManifest.js'
import ProceduralModelEditor from './ProceduralModelEditor.vue'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'
const viewport = ref(null)
const proceduralModelEditorRef = ref(null)
const selectedName = ref('')
const selectedEditable = ref(false)
const precisionModeActive = ref(false)
const objects = ref([])
const command = ref('')
const aiPrompt = ref('')
const referenceImageDataUrl = ref('')
const referenceImageName = ref('')
const aiBusy = ref(false)
const characterPrompt = ref('一名完整的现代风格 3D 游戏角色，人体比例自然，包含头部、躯干、双臂、双腿、手掌和鞋子，适合第三人称视角观察')
const characterBusy = ref(false)
// Three.js Object3D must remain raw; deep Vue proxies violate Three.js property invariants.
const editingModel = shallowRef(null)
const editorOpen = ref(false)
const editorMode = ref('edit')
const isDraftModel = ref(false)
const generationProgress = ref([])
const editBusy = ref(false)
const editError = ref('')
const editHistory = ref([])
const message = ref('正在初始化空白沙盒…')
const saveStatus = ref('尚未保存')
const worldState = ref(null)
const selectedChunkKey = ref('')
const selectedChunkKeys = ref([])
const reclaimFeedback = ref(null)
const selectedChunks = computed(() => (worldState.value?.chunks || []).filter(item => selectedChunkKeys.value.includes(item.x + ':' + item.z)))
const managementMode = ref('sandbox')
const sandboxViewMode = ref('free')
function selectSandboxViewMode(mode) {
  if (!['free', '2.5d', '3d'].includes(mode)) return
  if (engine?.setViewMode?.(mode) === false) return
  sandboxViewMode.value = mode
}
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
const placement = ref({ active: false, stage: '', level: 0, hasTarget: false, candidateLocked: false, instruction: '' })
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
  selected = payload?.id ? engine?.getSandboxModel?.(payload.id) || null : null
  selectedName.value = selected?.name || ''
  selectedEditable.value = Boolean(selected?.userData?.proceduralModelSource)
  precisionModeActive.value = false
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
  bulb.userData.componentId = 'demo-light-bulb'
  bulb.userData.stateBinding = { key: 'enabled', property: 'emissiveIntensity', enabledValue: 1.4, disabledValue: 0 }
  lamp.add(bulb)
  const pointLight = new THREE.PointLight('#ffd98a', 2.2, 11, 1.8)
  pointLight.position.set(0, 1.9, 0)
  pointLight.castShadow = true
  pointLight.userData.componentId = 'demo-point-light'
  pointLight.userData.stateBinding = { key: 'enabled', property: 'intensity', enabledValue: 2.2, disabledValue: 0 }
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
  plate.userData.componentId = 'wall-switch-plate'
  switchRoot.add(plate)
  const button = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.38, 0.1),
    new THREE.MeshStandardMaterial({ color: '#b7c6c0', roughness: 0.35 }),
  )
  button.position.set(0, 1.2, 0.11)
  button.userData.componentId = 'wall-switch-button'
  button.userData.displayName = '墙壁开关'
  button.userData.interactionConfig = {
    action: 'toggle',
    targetId: lampRoot.userData.sandboxModelId,
    stateKey: 'enabled',
    radius: 4.8,
    prompt: '靠近墙壁开关，按 E 切换演示灯具',
    openMessage: '演示灯具已开启',
    closeMessage: '演示灯具已关闭',
  }
  switchRoot.add(button)
  switchRoot.userData.interactionMessage = '你按下了墙壁开关'
  const switchPosition = { x: player.x + 2, y: 0, z: player.z + 2 }
  registerModel(switchRoot, '墙壁开关', switchPosition)
  message.value = '已创建灯具与墙壁开关演示。靠近开关按 E，验证灯具亮灭。'
  saveStatus.value = '未保存演示场景'
}

function handleSandboxModelInteract(payload) {
  const result = engine?.applySandboxModelInteraction?.(payload || {})
  if (!result?.ok) {
    const errors = {
      'target-part-not-found': '交互目标部件不存在，无法执行动作',
      'interior-entry-point-not-found': '内部入口部件不存在，无法进入',
      'interior-entry-point-not-declared': '模型没有声明这个内部入口',
      'interior-entry-point-blocked': '内部入口位置被碰撞体占据，请调整入口点或墙体碰撞声明',
      'already-inside-model': '当前已经处于一个模型的内部空间',
      'not-inside-target-model': '当前不在这个模型内部，无法从此处退出',
      'interior-source-mismatch': '进入和退出动作必须由当前模型自身触发',
      'player-teleport-failed': '人物位置切换失败',
    }
    message.value = errors[result?.reason] || '当前模型未声明可执行的交互动作'
    return
  }
  const config = payload?.config || {}
  if (result.statePatch) {
    const enabled = Boolean(result.state?.[result.stateKey])
    const defaultOn = result.stateKey === 'doorOpen' ? '门已打开' : '状态已开启'
    const defaultOff = result.stateKey === 'doorOpen' ? '门已关闭' : '状态已关闭'
    message.value = enabled ? (config.openMessage || defaultOn) : (config.closeMessage || defaultOff)
  } else if (result.action === 'enter') {
    message.value = '已进入模型内部空间'
  } else if (result.action === 'exit') {
    message.value = '已返回进入前的位置'
  } else {
    message.value = config.successMessage || ('已执行 ' + result.action + ' 动作')
  }
  if (result.action !== 'enter' && result.action !== 'exit') {
    saveStatus.value = '状态已变更，记得保存'
  }
}

function selectModel(item) {
  const id = item?.id || item?.userData?.sandboxModelId
  if (id) engine?.selectSandboxModel(id)
}
function setMode(mode) {
  transformMode.value = mode
  precisionModeActive.value = mode !== 'browse'
  engine?.setSandboxTransformMode(mode)
}
function beginMoveSelected() {
  if (!selected) return
  precisionModeActive.value = false
  engine?.setSandboxTransformMode('browse')
  const started = engine?.beginSandboxModelPlacement(selected.userData.sandboxModelId)
  if (started) message.value = '已进入全局选址。移动鼠标预览占地范围，点击地面锁定候选位置。'
}
function confirmPlacement() {
  if (!engine?.confirmSandboxModelPlacement?.()) {
    message.value = placement.value.blocked
      ? `当前位置与“${placement.value.blockerName || '已有物体'}”重叠，不能落地。请重新选择位置。`
      : '请先点击沙盒地面锁定一个可用候选位置，再确认落地。'
  }
}
function unlockPlacementCandidate() {
  engine?.unlockSandboxPlacementCandidate?.()
}
function cancelPlacement() {
  engine?.cancelSandboxModelPlacement?.()
}
function handlePlacementChange(payload) {
  placement.value = payload || { active: false }
  if (payload?.confirmed && payload.id) {
    const model = engine?.getSandboxModel(payload.id)
    if (model) {
      objectsById.set(payload.id, model)
      selected = model
    }
    syncObjects()
    setMode('translate')
    const saved = saveSandbox()
    message.value = saved ? '模型已完成落位并保存；可继续旋转、高度和缩放微调。' : '模型已完成落位，但存档失败，请检查存储空间后重试。'
    saveStatus.value = saved ? '已保存' : '存档失败'
  } else if (payload?.cancelled) {
    syncObjects()
    message.value = payload.existing ? '已取消移动，模型恢复原位置。' : '已取消新模型放置。'
  } else if (payload?.active) {
    message.value = payload.instruction || '正在进行分层选址。'
  }
}
function deleteSelected() {
  if (!selected) return
  const id = selected.userData.sandboxModelId
  const removed = engine?.removeSandboxModel(id)
  if (!removed) return
  objectsById.delete(id)
  selected = null
  selectedEditable.value = false
  precisionModeActive.value = false
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
    status: event.status || 'active',
  }
  if (index >= 0) next[index] = entry
  else next.push(entry)
  generationProgress.value = next
}

async function runModelVisualQualityControl(originalPrompt) {
  updateGenerationProgress({
    stage: 'visual-inspection',
    label: 'AI 多视角视觉质量检测',
    detail: '正在从 Three.js 实际预览采集正面、侧面、顶部和等轴视图',
    status: 'active',
  })
  try {
    await nextTick()
    const screenshots = await proceduralModelEditorRef.value?.captureVisualViews?.()
    if (!Array.isArray(screenshots) || screenshots.length < 3) {
      throw new Error('无法从模型预览采集足够的多视角截图')
    }
    let latestReport = null
    for (let round = 0; round <= 2; round += 1) {
      const current = editingModel.value
      if (!current) throw new Error('视觉质检时模型实例已丢失')
      updateGenerationProgress({
        stage: 'visual-inspection',
        label: round === 0 ? 'AI 视觉质量检测' : `第 ${round} 轮修正后复检`,
        detail: `正在分析 ${screenshots.length} 个实际渲染视角`,
        status: 'active',
      })
      const inspectResponse = await fetch(API_BASE + '/assets/ai-image/inspect-procedural-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
        body: JSON.stringify({
          prompt: originalPrompt,
          objectType: current.userData.proceduralModelConfig?.objectType || '独立 3D 模型',
          referenceImageDataUrl: referenceImageDataUrl.value || undefined,
          screenshots,
          geometryDiagnostics: current.userData.proceduralModelGeometryDiagnostics || null,
        }),
      })
      const inspectBody = await inspectResponse.json().catch(() => ({}))
      if (!inspectResponse.ok) throw new Error(inspectBody.message || 'AI 视觉质量检测失败：HTTP ' + inspectResponse.status)
      latestReport = inspectBody.data || inspectBody.result || inspectBody
      current.userData.proceduralModelVisualQuality = latestReport
      if (latestReport.passed === true) {
        updateGenerationProgress({
          stage: 'visual-inspection',
          label: '视觉质量检测通过',
          detail: `评分 ${latestReport.score}/100：${latestReport.summary || '未发现需要自动修复的主要视觉问题'}`,
          status: 'done',
        })
        return latestReport
      }
      const actionable = (latestReport.issues || []).filter(item =>
        ['critical', 'major'].includes(item.severity) && item.repairInstruction,
      )
      if (round === 2 || !actionable.length) {
        updateGenerationProgress({
          stage: 'visual-inspection',
          label: '视觉质检未通过，保留人工调整',
          detail: latestReport.summary || '检测到问题，但没有可安全自动执行的明确修复建议',
          status: 'failed',
        })
        return latestReport
      }
      updateGenerationProgress({
        stage: 'visual-repair',
        label: `自动定向修正（${round + 1}/2）`,
        detail: actionable.map(item => item.issue).join('；').slice(0, 500),
        status: 'active',
      })
      const instruction = [
        '这是自动视觉质检后的定向修复。请根据以下可观察问题做最小必要修改，不要整体重建模型，不要修改无关部件，保留模型身份、现有稳定 componentId、参数、能力声明和交互结构。',
        ...actionable.map((item, index) => `${index + 1}. [${item.componentId || '整体模型'}] ${item.issue}。修复要求：${item.repairInstruction}`),
      ].join('\n')
      const repairResponse = await fetch(API_BASE + '/assets/ai-image/modify-procedural-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
        body: JSON.stringify({
          source: current.userData.proceduralModelSource,
          parameters: current.userData.proceduralModelParameters || [],
          parameterValues: current.userData.proceduralModelParameterValues || {},
          parts: current.userData.proceduralModelParts || [],
          environmentBindings: current.userData.proceduralModelEnvironmentBindings || [],
          modelCapabilityManifest: current.userData.proceduralModelCapabilityManifest || null,
          geometryDiagnostics: current.userData.proceduralModelGeometryDiagnostics || null,
          selectedPartId: '',
          instruction,
          objectType: current.userData.proceduralModelConfig?.objectType || '独立 3D 模型',
        }),
      })
      const repairBody = await repairResponse.json().catch(() => ({}))
      if (!repairResponse.ok) throw new Error(repairBody.message || 'AI 自动修正失败：HTTP ' + repairResponse.status)
      const result = repairBody.data || repairBody.result || repairBody
      await replaceEditedModel(
        result.generatedCode,
        current.userData.proceduralModelParameterValues || {},
        result.parameters || result.modelParameters || current.userData.proceduralModelParameters || [],
        result.parts || result.modelParts || current.userData.proceduralModelParts || [],
        'AI 视觉质检自动修正完成',
        true,
        result.environmentBindings,
        result.modelCapabilityManifest,
      )
      if (editingModel.value) editingModel.value.userData.proceduralModelVisualQuality = latestReport
      await nextTick()
      const refreshed = await proceduralModelEditorRef.value?.captureVisualViews?.()
      if (!Array.isArray(refreshed) || refreshed.length < 3) throw new Error('自动修正后无法重新采集视觉截图')
      screenshots.splice(0, screenshots.length, ...refreshed)
    }
    if (editingModel.value && latestReport) editingModel.value.userData.proceduralModelVisualQuality = latestReport
    return latestReport
  } catch (error) {
    updateGenerationProgress({
      stage: 'visual-inspection',
      label: '视觉质检未完成',
      detail: error?.message || '视觉检测服务异常',
      status: 'failed',
    })
    return null
  }
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
    label: '提交完整模型生成请求',
    detail: '描述与参考图将直接用于一次性生成完整 Three.js 模型',
    status: 'active',
  }]
  message.value = '正在生成完整 Three.js 模型…'

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
      throw new Error(payload.message || '模型生成失败：HTTP ' + response.status)
    }

    let buffer = ''
    let result = null
    let completed = false
    const decoder = new TextDecoder()
    const processEvent = async event => {
      if (!event || typeof event.type !== 'string') return
      if (event.type === 'stage') {
        updateGenerationProgress({
          stage: event.stage,
          label: event.label || event.stage,
          detail: event.detail || '',
          status: event.status || 'active',
        })
        return
      }
      if (event.type === 'single') {
        result = event.result
        return
      }
      if (event.type === 'error') {
        throw new Error(event.message || '模型生成失败')
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
    if (!completed || !result?.generatedCode) {
      throw new Error('模型生成事件流提前结束，未收到完整模型源码')
    }

    updateGenerationProgress({
      stage: 'worker-start',
      label: '构建完整 3D 模型',
      detail: 'AI 已返回完整模型源码，正在隔离 Worker 中创建 Three.js 对象',
    })
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
      generationMetrics: result.generationMetrics || null,
    }
    group.userData.proceduralModelSource = result.generatedCode
    group.userData.interactionRadius = Number(group.userData.interactionRadius) || 4.5
    editingModel.value = group

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
    model.name = model.userData.assetName || result.objectType || 'AI 程序化模型'
    await runModelVisualQualityControl(prompt)
    generationProgress.value = generationProgress.value.map(item => item.stage === 'visual-inspection' || item.stage === 'visual-repair'
      ? item
      : ({ ...item, status: 'done' }))
    generationProgress.value.push({
      stage: 'preview-ready',
      label: '模型预览已就绪',
      detail: '完整模型已构建；可以继续调整参数或通过 AI 对话编辑，保存后才会加入沙盒',
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


async function generateAiPlayerCharacter() {
  const prompt = characterPrompt.value.trim()
  if (!prompt || characterBusy.value) return
  if (!engine?.setPlayerCharacterModel) {
    message.value = '当前场景不支持角色替换'
    return
  }
  characterBusy.value = true
  message.value = '正在通过 AI 生成角色模型…'
  try {
    const response = await fetch(API_BASE + '/assets/ai-image/generate-procedural-object-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({
        prompt: prompt + '。请生成一个完整、居中、Y 轴向上的可渲染人形角色模型，双脚落在模型底部基准面，正面朝向 +Z。使用适度细节的 Three.js 几何体和材质构建完整身体，不要生成地面、底座、场景或文字。模型必须是单一完整角色层级，便于作为玩家外观替换。',
        objectType: '第三人称玩家角色',
        visualStyle: 'stylized',
      }),
    })
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.message || 'AI 角色生成失败：HTTP ' + response.status)
    }
    let buffer = ''
    let result = null
    let completed = false
    const decoder = new TextDecoder()
    const processEvent = event => {
      if (!event || typeof event.type !== 'string') return
      if (event.type === 'single') result = event.result
      else if (event.type === 'error') throw new Error(event.message || 'AI 角色生成失败')
      else if (event.type === 'complete') completed = true
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
        if (line) processEvent(JSON.parse(line))
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) processEvent(JSON.parse(buffer.trim()))
    if (!completed || !result?.generatedCode) throw new Error('AI 角色生成事件流提前结束，未收到完整模型源码')

    message.value = 'AI 已返回角色模型，正在隔离 Worker 中构建…'
    const model = await executeProceduralModel(result.generatedCode, { timeoutMs: 60000 })
    model.name = 'AI 玩家角色'
    const info = engine.setPlayerCharacterModel(model, [], {
      assetId: 'ai-character-' + Date.now().toString(36),
      targetHeight: 2.25,
      source: 'ai-procedural',
      prompt,
    })
    message.value = `AI 角色已加载：高度 ${info.dimensions?.height?.toFixed(2) || '—'}，碰撞半径 ${info.dimensions?.colliderRadius?.toFixed(2) || '—'}。当前模型未提供动作剪辑时使用基础移动表现。`
  } catch (error) {
    message.value = 'AI 角色生成失败：' + (error?.message || '未知错误')
  } finally {
    characterBusy.value = false
  }
}

async function importPlayerCharacter(event) {
  const file = event?.target?.files?.[0]
  if (!file || characterBusy.value) return
  if (!/\.glb$/i.test(file.name)) {
    message.value = '当前仅支持单文件 GLB 导入；含外部依赖的 glTF 暂不支持'
    event.target.value = ''
    return
  }
  characterBusy.value = true
  const objectUrl = URL.createObjectURL(file)
  try {
    const info = await engine.loadPlayerCharacter(objectUrl, { assetId: 'glb:' + file.name, source: 'glb' })
    message.value = `GLB 角色已加载：高度 ${info.dimensions?.height?.toFixed(2) || '—'}，碰撞半径 ${info.dimensions?.colliderRadius?.toFixed(2) || '—'}。`
  } catch (error) {
    message.value = 'GLB 角色导入失败：' + (error?.message || '未知错误')
  } finally {
    URL.revokeObjectURL(objectUrl)
    characterBusy.value = false
    event.target.value = ''
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
    model.name = name + ' ' + (objects.value.length + 1)
    const started = engine?.beginSandboxModelPlacement?.(model)
    if (!started) {
      message.value = '无法启动模型选址，请确认当前处于室外沙盒且模型未被挂载。'
      return
    }
    isDraftModel.value = false
    aiPrompt.value = ''
    referenceImageDataUrl.value = ''
    referenceImageName.value = ''
    editorOpen.value = false
    editingModel.value = null
    message.value = '模型已生成，尚未加入存档。请从沙盒全貌逐级选择区域并确认落位。'
    return
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
  // Prefer the manifest exported by the exact source that Worker just executed.
  // The API envelope may contain a compatibility fallback to the previous manifest.
  const hasModuleManifest = replacement.userData.proceduralModelCapabilityManifestSource === 'module'
  const resolvedCapabilityManifest = hasModuleManifest
    ? moduleCapabilityManifest
    : (modelCapabilityManifest && typeof modelCapabilityManifest === 'object'
      ? modelCapabilityManifest
      : (current.userData.proceduralModelCapabilityManifest || moduleCapabilityManifest || null))
  const manifestCapabilities = resolvedCapabilityManifest?.capabilities && typeof resolvedCapabilityManifest.capabilities === 'object'
    ? resolvedCapabilityManifest.capabilities : {}
  const resolvedDefinitions = Array.isArray(resolvedCapabilityManifest?.parameters)
    ? resolvedCapabilityManifest.parameters
    : (Array.isArray(definitions) && definitions.length ? definitions : moduleDefinitions)
  const resolvedParts = resolveProceduralModelParts({
    moduleParts,
    modulePartsSource: replacement.userData.proceduralModelPartsSource,
    responseParts: parts,
    currentParts: current.userData.proceduralModelParts,
  })
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

function expandWorld(direction) {
  if (!engine) return false
  const expanded = engine.expandSandboxWorld(direction, 1)
  if (!expanded) {
    message.value = '世界扩建失败，请检查当前沙盒状态'
    return false
  }
  worldState.value = engine.getSandboxWorldState()
  const bounds = worldState.value?.bounds
  message.value = bounds
    ? `世界已扩建：${(bounds.maxX - bounds.minX).toFixed(0)} × ${(bounds.maxZ - bounds.minZ).toFixed(0)}，原有模型坐标保持不变。`
    : '世界已扩建，原有模型坐标保持不变。'
  saveStatus.value = '有未保存的世界变更'
  return true
}

function setManagementMode(mode) {
  const nextMode = mode === 'chunks' ? 'chunks' : mode === 'model' ? 'model' : 'sandbox'
  if (managementMode.value === 'chunks' && nextMode !== 'chunks') {
    engine?.setSandboxChunkManagement?.(false)
    selectedChunkKeys.value = []
    selectedChunkKey.value = ''
    reclaimFeedback.value = null
  }
  managementMode.value = nextMode
  if (nextMode === 'chunks') engine?.setSandboxChunkManagement?.(true)
}

function toggleChunkManagement() {
  setManagementMode(managementMode.value === 'chunks' ? 'sandbox' : 'chunks')
}

function handleSandboxChunkSelectionChange(payload) {
  const chunks = Array.isArray(payload?.chunks) ? payload.chunks : []
  selectedChunkKeys.value = chunks.map(item => item.x + ':' + item.z)
  if (payload?.primary) selectedChunkKey.value = payload.primary.x + ':' + payload.primary.z
  else selectedChunkKey.value = selectedChunkKeys.value[selectedChunkKeys.value.length - 1] || ''
  reclaimFeedback.value = null
}

function removeSelectedWorldChunks() {
  if (!engine || placement.value.active || !selectedChunks.value.length) return false
  reclaimFeedback.value = null
  const targets = [...selectedChunks.value]
  const failures = []
  let removed = 0
  for (const chunk of targets) {
    const result = engine.removeSandboxWorldChunk(chunk.x, chunk.z)
    if (result?.ok) {
      removed += 1
      worldState.value = result.world || engine.getSandboxWorldState()
    } else {
      const reasonMessages = {
        'origin-anchor': '世界锚点受保护',
        'chunk-not-found': '地块已不存在',
        'occupied': '仍有玩家、模型或碰撞对象占用',
        'cannot-remove-chunk': '至少需要保留一个地块',
        'invalid-chunk': '地块坐标无效',
      }
      failures.push({ chunk, reason: reasonMessages[result?.reason] || '系统拒绝回收', blockers: [...new Set(result?.blockers || [])] })
    }
  }
  const remainingKeys = new Set((worldState.value?.chunks || []).map(chunk => chunk.x + ':' + chunk.z))
  selectedChunkKeys.value = selectedChunkKeys.value.filter(key => remainingKeys.has(key))
  selectedChunkKey.value = selectedChunkKeys.value[selectedChunkKeys.value.length - 1] || ''
  engine.setSandboxChunkSelection(selectedChunks.value)
  if (removed) saveStatus.value = '有未保存的世界变更'
  if (failures.length) {
    reclaimFeedback.value = {
      type: removed ? 'warning' : 'error',
      title: removed ? '部分地块已回收' : '地块回收失败',
      message: `已回收 ${removed} 块，${failures.length} 块未回收。被占用或受保护的地块已保留。`,
      blockers: failures.flatMap(item => [
        `地块（${item.chunk.x}, ${item.chunk.z}）：${item.reason}`,
        ...item.blockers.map(blocker => `  · ${blocker}`),
      ]),
    }
  } else {
    reclaimFeedback.value = {
      type: 'success',
      title: '批量回收完成',
      message: `已成功回收 ${removed} 块地块，其他地块的位置没有变化。`,
      blockers: [],
    }
  }
  message.value = reclaimFeedback.value.message
  return failures.length === 0
}

function saveSandbox() {
  if (!engine) return false
  try {
    const models = engine.getSandboxModels().flatMap(({ id, name }) => {
      const model = engine.getSandboxModel(id)
      return model ? [{ id, name: model.name || name, object: model.toJSON() }] : []
    })
    const snapshot = {
      version: 4,
      world: engine.getSandboxWorldState(),
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
    if (![1, 2, 3, 4].includes(snapshot?.version) || !Array.isArray(snapshot.models)) throw new Error('保存文件版本不兼容')
    if (snapshot.world) {
      const restoredWorld = engine.restoreSandboxWorld(snapshot.world)
      if (!restoredWorld) throw new Error('世界区块存档无效或与当前区块规格不兼容')
      worldState.value = engine.getSandboxWorldState()
    } else {
      worldState.value = engine.getSandboxWorldState()
    }
    const loader = new THREE.ObjectLoader()
    const restoredModels = snapshot.models
      .filter(item => item?.object && item?.id)
      .map(item => {
        const model = loader.parse(item.object)
        model.name = item.name || model.name || '已保存模型'
        model.userData = {
          ...(model.userData || {}),
          proceduralModelCapabilityControlDocument: model.userData?.proceduralModelCapabilityControlDocument
            || createCapabilityControlDocument({ manifest: model.userData?.proceduralModelCapabilityManifest }),
        }
        return { id: String(item.id), model }
      })
    const registeredIds = []
    try {
      for (const { id, model } of restoredModels) {
        // ObjectLoader 已从存档恢复完整 Transform；显式传回原位置，避免 addSandboxModel 的新模型默认落点覆盖存档坐标。
        const registeredId = engine.addSandboxModel(model, {
          name: model.name,
          id,
          position: { x: model.position.x, y: model.position.y, z: model.position.z },
        })
        registeredIds.push(registeredId)
        objectsById.set(registeredId, model)
      }
    } catch (error) {
      for (const id of registeredIds) {
        engine.removeSandboxModel(id)
        objectsById.delete(id)
      }
      throw error
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
    else {
      engine?.setSandboxModelTransform(selected.userData.sandboxModelId, {
        position: { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) },
      })
      message.value = '模型已移动到指定坐标'
    }
  } else if (/旋转|rotate/i.test(text)) {
    const degrees = Number((text.match(/-?\d+(?:\.\d+)?/) || [0])[0])
    if (!selected) message.value = '请先选择一个模型'
    else {
      engine?.setSandboxModelTransform(selected.userData.sandboxModelId, {
        rotation: { y: selected.rotation.y + THREE.MathUtils.degToRad(degrees) },
      })
      message.value = '模型已旋转 ' + degrees + '°'
    }
  } else message.value = '试试：创建球体、移动 2,0,3、旋转 45、切换雨天、时间 18 点、复制、删除。'
  command.value = ''
  syncObjects()
}
onMounted(async () => {
  disposed = false
  try {
    engine = createCampusEngine(viewport.value, {
      onReady: () => { worldState.value = engine?.getSandboxWorldState?.() || null; message.value = '空白沙盒已就绪，可生成模型并放置到场景中。' },
      onError: error => { message.value = '沙盒初始化失败：' + (error?.message || '未知错误') },
      onSandboxModelsChange: list => { objects.value = list },
      onSandboxWorldChange: state => { worldState.value = state },
      onSandboxChunkSelectionChange: handleSandboxChunkSelectionChange,
      onSandboxPlacementChange: handlePlacementChange,
      onSandboxModelSelected: handleModelSelected,
      onSandboxInteractionPromptChange: payload => {
        if (payload?.visible) message.value = payload.text
        else if (message.value.startsWith('靠近 ')) message.value = '使用 WASD 或方向键移动人物，靠近模型按 E 交互。'
      },
      onSandboxModelInteract: handleSandboxModelInteract,
    }, {
      // MVP 使用独立空白沙盒：只创建地面与世界边界，不加载任何写死的校园内容。
      sceneType: 'blank-sandbox',
      isometricRpg: true,
      viewMode: '3d',
      worldBounds: { width: 54, depth: 42 },
    })
    await engine.init()
    if (disposed) return
    engine.setMode('overview')
    engine.setViewMode('free')
    engine.setSandboxTransformMode(transformMode.value)
    const restored = await restoreSandbox()
    if (!restored) {
      updateEnvironment()
      syncObjects()
    }
  } catch (error) {
    message.value = '沙盒初始化失败：' + (error?.message || '未知错误')
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
      <div class="world-mvp__brand"><strong>WORLD SANDBOX</strong><span>空白世界 · AI 模型构建与交互</span></div>
      <div class="world-mvp__header-actions"><div class="world-mvp__view-switch" role="group" aria-label="沙盒视角"><button :class="{ active: sandboxViewMode === 'free' }" @click="selectSandboxViewMode('free')">自由视角</button><button :class="{ active: sandboxViewMode === '2.5d' }" @click="selectSandboxViewMode('2.5d')">2.5D</button><button :class="{ active: sandboxViewMode === '3d' }" @click="selectSandboxViewMode('3d')">3D</button></div><button :class="{ active: managementMode === 'sandbox' }" @click="setManagementMode('sandbox')">沙盒管理</button><button :class="{ active: managementMode === 'chunks' }" @click="toggleChunkManagement">{{ managementMode === 'chunks' ? '退出地块管理' : '地块管理' }}</button><button :class="{ active: managementMode === 'model' }" @click="setManagementMode('model')">模型管理</button><span class="world-mvp__save-status">{{ saveStatus }}</span><button class="world-mvp__save-button" :disabled="placement.active" @click="saveSandbox">保存沙盒</button><a href="/">返回地图</a></div>
    </header>

    <section v-if="managementMode === 'chunks' && !placement.active" class="world-mvp__chunk-manager">
      <div class="world-mvp__chunk-manager-head">
        <div><b>地块管理已开启</b><span>直接点击沙盒地面选择地块；Ctrl / Shift / Cmd 点击可多选。场景模型保持显示。</span></div>
        <div class="world-mvp__chunk-manager-actions">
          <span>已选 {{ selectedChunks.length }} / {{ worldState?.chunks?.length || 0 }}</span>
          <button @click="selectedChunkKeys = []; selectedChunkKey = ''; engine?.setSandboxChunkSelection?.([])">清空</button>
          <button class="danger" :disabled="!selectedChunks.length" @click="removeSelectedWorldChunks">回收选中</button>
          <button @click="toggleChunkManagement">完成</button>
        </div>
      </div>
      <div v-if="selectedChunks.length" class="world-mvp__chunk-manager-selected">
        <b>当前选择</b>
        <span v-for="chunk in selectedChunks.slice(0, 8)" :key="chunk.x + ':' + chunk.z">({{ chunk.x }}, {{ chunk.z }}){{ chunk.x === 0 && chunk.z === 0 ? ' · 锚点' : '' }}</span>
        <small v-if="selectedChunks.length > 8">另有 {{ selectedChunks.length - 8 }} 块已选</small>
      </div>
      <div v-if="reclaimFeedback" class="world-mvp__reclaim-feedback" :class="reclaimFeedback.type" role="status" aria-live="polite">
        <b>{{ reclaimFeedback.title }}</b><p>{{ reclaimFeedback.message }}</p>
        <ul v-if="reclaimFeedback.blockers.length"><li v-for="(blocker, index) in reclaimFeedback.blockers" :key="index">{{ blocker }}</li></ul>
      </div>
    </section>
    <aside v-if="managementMode !== 'chunks'" class="world-mvp__panel">
      <template v-if="placement.active">
        <section class="world-mvp__operation-panel">
          <h2>重新选址 · 全局视图</h2>
          <strong class="world-mvp__operation-name">{{ placement.modelName || selectedName || '当前模型' }}</strong>
          <p class="world-mvp__message">沙盒保持全景视野。移动鼠标查看模型占地；绿色表示可放置，红色表示与已有模型或碰撞区域重叠。点击地面只锁定候选位置，不会落地或保存。</p>
          <div v-if="placement.footprint" class="world-mvp__footprint-info">
            <span>最大水平占地范围</span>
            <strong>{{ placement.footprint.width.toFixed(2) }} × {{ placement.footprint.depth.toFixed(2) }}</strong>
            <small>世界单位 · 模型包围盒水平投影</small>
          </div>
          <div v-if="placement.target && placement.candidateLocked" class="world-mvp__footprint-info">
            <span>候选位置</span>
            <strong>X {{ placement.target.x.toFixed(2) }} / Z {{ placement.target.z.toFixed(2) }}</strong>
          </div>
          <p class="world-mvp__placement-status" :class="{ 'is-blocked': placement.blocked }">{{ placement.blocked ? `位置冲突：与“${placement.blockerName || '已有物体'}”重叠，禁止落地。` : placement.candidateLocked ? '候选位置已锁定且无冲突，可以确认落地。' : '尚未锁定位置，请在沙盒地面点击目标位置。' }}</p>
          <div class="world-mvp__tools world-mvp__placement-actions">
            <button :disabled="!placement.candidateLocked || placement.blocked" @click="confirmPlacement">确认落地</button>
            <button :disabled="!placement.candidateLocked" @click="unlockPlacementCandidate">重新选择</button>
            <button @click="cancelPlacement">取消</button>
          </div>
          <div class="world-mvp__placement-expand">
            <span>空间不足？直接扩建世界</span>
            <div class="world-mvp__expand-grid">
              <span></span><button @click="expandWorld('north')">北</button><span></span>
              <button @click="expandWorld('west')">西</button><span class="world-mvp__world-center">扩建</span><button @click="expandWorld('east')">东</button>
              <span></span><button @click="expandWorld('south')">南</button><span></span>
            </div>
          </div>
        </section>
      </template>
      <template v-else-if="managementMode === 'model' && selectedName">
        <section class="world-mvp__operation-panel">
          <h2>{{ precisionModeActive ? '精细调整' : '模型管理' }}</h2>
          <div class="world-mvp__list"><button v-for="item in objects" :key="item.id" :class="{ active: selectedName === item.name }" @click="selectModel(item)">{{ item.name }}</button></div>
          <strong class="world-mvp__operation-name">{{ selectedName }}</strong>
          <template v-if="precisionModeActive">
            <p class="world-mvp__message">当前仅操作这个模型。拖动坐标轴调整对象，镜头输入已锁定。</p>
            <div class="world-mvp__tools world-mvp__transform-actions">
              <button :class="{ active: transformMode === 'translate' }" @click="setMode('translate')">位置</button>
              <button :class="{ active: transformMode === 'rotate' }" @click="setMode('rotate')">旋转</button>
              <button :class="{ active: transformMode === 'scale' }" @click="setMode('scale')">缩放</button>
              <button @click="setMode('browse')">完成调整</button>
            </div>
          </template>
          <template v-else>
            <p class="world-mvp__message">当前面板只管理这个模型，不显示其他场景工具。</p>
            <div class="world-mvp__tools world-mvp__primary-actions">
              <button @click="beginMoveSelected">重新选址</button>
              <button @click="setMode('translate')">精细调整</button>
              <button :disabled="!selectedEditable" @click="openModelEditor()">编辑模型</button>
            </div>
            <div class="world-mvp__tools world-mvp__secondary-actions">
              <button @click="duplicateSelected">复制</button>
              <button @click="deleteSelected">删除</button>
            </div>
          </template>
          <section>
            <h2>创建新模型</h2>
            <div class="world-mvp__command">
              <input v-model="aiPrompt" placeholder="描述要创建的新模型" @keydown.enter="generateAiModel">
              <button :disabled="aiBusy || (!aiPrompt.trim() && !referenceImageDataUrl)" @click="generateAiModel">{{ aiBusy ? '生成中' : '生成' }}</button>
            </div>
            <div class="world-mvp__command" style="margin-top:7px">
              <input type="file" accept="image/png,image/jpeg,image/webp" @change="onReferenceImageChange">
            </div>
          </section>
        </section>
      </template>
      <template v-else>
        <section v-if="managementMode === 'sandbox'" class="world-mvp__world-panel">
          <h2>世界空间</h2>
          <p class="world-mvp__message">当前世界可向四周扩建。扩建只增加空间，不移动已有模型；区域分组是可选管理功能，不影响自由建造。</p>
          <div class="world-mvp__world-size">
            <span>当前世界尺寸</span>
            <strong>{{ worldState?.bounds ? (worldState.bounds.maxX - worldState.bounds.minX).toFixed(0) + ' × ' + (worldState.bounds.maxZ - worldState.bounds.minZ).toFixed(0) : '54 × 42' }}</strong>
          </div>
          <div class="world-mvp__expand-grid">
            <span></span><button :disabled="placement.active" @click="expandWorld('north')">向北扩建</button><span></span>
            <button :disabled="placement.active" @click="expandWorld('west')">向西扩建</button>
            <span class="world-mvp__world-center">当前世界</span>
            <button :disabled="placement.active" @click="expandWorld('east')">向东扩建</button>
            <span></span><button :disabled="placement.active" @click="expandWorld('south')">向南扩建</button><span></span>
          </div>
          <button class="world-mvp__open-chunk-manager" @click="toggleChunkManagement">在沙盒场景中管理地块 <span>{{ worldState?.chunks?.length || 0 }} 个地块 · 场景物体保持可见</span></button>
        </section>
        <section v-if="managementMode === 'model'">
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
        <section v-if="managementMode === 'model'">
          <h2>模型列表与基础模型</h2>
          <div class="world-mvp__model-grid">
            <button v-for="item in objectTypes" :key="item.id" @click="addModel(item.id)">＋ {{ item.label }}</button>
          </div>
          <button class="world-mvp__demo-button" @click="addLightSwitchDemo">创建开关灯交互演示</button>
          <div class="world-mvp__list">
            <button v-for="item in objects" :key="item.id" :class="{ active: selectedName === item.name }" @click="selectModel(item)">{{ item.name }}</button>
          </div>
        </section>
        <section v-if="managementMode === 'sandbox'">
          <h2>场景信息</h2>
          <p class="world-mvp__message">已加载南昌工学院校园空间底图，校园建筑、道路、湖泊和公共区域作为场景环境。</p>
        </section>

        <section v-if="managementMode === 'sandbox'">
          <h2>玩家角色</h2>
          <div class="world-mvp__command">
            <input v-model="characterPrompt" :disabled="characterBusy" placeholder="描述要生成的玩家角色" @keydown.enter="generateAiPlayerCharacter">
            <button :disabled="characterBusy || !characterPrompt.trim()" @click="generateAiPlayerCharacter">{{ characterBusy ? '生成中' : 'AI 生成角色' }}</button>
          </div>
          <div class="world-mvp__command" style="margin-top:7px">
            <input type="file" accept=".glb,model/gltf-binary" :disabled="characterBusy" @change="importPlayerCharacter">
          </div>
          <div class="world-mvp__tools">
            <button :disabled="characterBusy" @click="engine?.restorePlayerCharacterFallback?.()">恢复默认角色</button>
          </div>
          <p class="world-mvp__message">支持 AI 程序化生成与单文件 GLB 导入。角色外观、碰撞半径和视点高度由同一运行时适配；无动画资源时保留基础移动。</p>
        </section>
        <section v-if="managementMode === 'sandbox'">
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
        <section v-if="managementMode === 'model'">
          <h2>快捷操作</h2>
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
      </template>
    </aside>
    <ProceduralModelEditor
      ref="proceduralModelEditorRef"
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
    <footer class="world-mvp__help">WASD / 方向键移动角色 · 沙盒默认仅保留空白地面 · 重新选址会检测已有模型占地冲突</footer>
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
.world-mvp__view-switch { display:flex; align-items:center; gap:3px; padding:3px; border:1px solid rgba(165,201,177,.25); border-radius:8px; background:rgba(0,0,0,.16); }
.world-mvp__view-switch button { padding:6px 8px; border-color:transparent; white-space:nowrap; }
.world-mvp__view-switch button.active { border-color:#a5c9b1; color:#c6e4ce; background:rgba(165,201,177,.16); }
.world-mvp__chunk-manager { position:absolute; z-index:4; top:76px; right:14px; width:min(420px,calc(100vw - 28px)); max-height:42vh; overflow:auto; padding:12px; border:1px solid rgba(255,255,255,.14); border-radius:10px; background:rgba(12,21,27,.9); box-shadow:0 12px 34px rgba(0,0,0,.28); backdrop-filter:blur(12px); }
.world-mvp__chunk-manager-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.world-mvp__chunk-manager-head > div:first-child { display:grid; gap:4px; }
.world-mvp__chunk-manager-head b { color:#e5efe8; font-size:12px; }
.world-mvp__chunk-manager-head span { color:#a9bbb3; font-size:10px; line-height:1.5; }
.world-mvp__chunk-manager-actions { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
.world-mvp__chunk-manager-actions > span { color:#c6e4ce; font-size:10px; }
.world-mvp__chunk-manager-actions .danger { border-color:rgba(230,139,126,.5); color:#ffc1b6; }
.world-mvp__chunk-manager-actions .danger:disabled { opacity:.35; }
.world-mvp__chunk-manager-selected { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-top:9px; padding-top:8px; border-top:1px solid rgba(255,255,255,.09); color:#b7c9bf; font-size:10px; }
.world-mvp__chunk-manager-selected b { color:#dce8df; }
.world-mvp__chunk-manager-selected span { padding:3px 6px; border:1px solid rgba(165,201,177,.25); border-radius:5px; background:rgba(165,201,177,.08); }
.world-mvp__chunk-manager-selected small { color:#9eafad; }
.world-mvp__open-chunk-manager { width:100%; margin-top:12px; padding:13px!important; border-color:rgba(165,201,177,.42)!important; text-align:left; color:#d5eadb!important; background:rgba(165,201,177,.08)!important; }
.world-mvp__open-chunk-manager span { display:block; margin-top:5px; color:#9eafad; font-size:10px; }
.world-mvp__map-toolbar { display:flex; align-items:center; justify-content:space-between; margin:9px 0 6px; color:#9eafae; font-size:10px; }
.world-mvp__map-toolbar div { display:flex; gap:5px; }
.world-mvp__map-toolbar button { width:27px; height:25px; padding:0; font-size:15px; }
.world-mvp__chunk-map-viewport { max-width:100%; max-height:260px; overflow:auto; border:1px solid rgba(255,255,255,.1); border-radius:9px; background:radial-gradient(ellipse at center,rgba(91,124,109,.12),rgba(13,23,29,.45)); }
.world-mvp__chunk-map { display:block; max-width:none; }
.world-mvp__chunk-map-item { cursor:pointer; }
.world-mvp__chunk-map-item rect { fill:#526b60; fill-opacity:.82; stroke:rgba(204,226,210,.35); stroke-width:1.3; transition:fill .15s,stroke .15s; }
.world-mvp__chunk-map-item:hover rect { fill:#708c78; }
.world-mvp__chunk-map-item.active rect { fill:#8cad91; stroke:#e2f4df; stroke-width:2.5; }
.world-mvp__chunk-map-item.anchor rect { fill:#405b51; stroke:#9eb9a8; stroke-dasharray:3 2; }
.world-mvp__chunk-map-item text { fill:#f0f5ef; font-size:10px; pointer-events:none; }
.world-mvp__selected-chunk { display:flex; flex-direction:column; gap:4px; margin-top:9px; padding:9px; border-radius:8px; background:rgba(165,201,177,.08); color:#dce8df; font-size:10px; }
.world-mvp__selected-chunk div { display:flex; justify-content:space-between; gap:8px; }
.world-mvp__selected-chunk small { color:#a8b8b3; }
.world-mvp .world-mvp__reclaim-button { width:100%; margin-top:8px; border-color:rgba(230,139,126,.4); color:#efb0a6; }
.world-mvp__reclaim-feedback { margin-top:9px; padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:8px; font-size:10px; line-height:1.5; }
.world-mvp__reclaim-feedback.error { border-color:rgba(230,139,126,.45); background:rgba(130,47,42,.16); color:#ffd1c9; }
.world-mvp__reclaim-feedback.success { border-color:rgba(130,190,145,.4); background:rgba(53,103,68,.16); color:#c8ebd0; }
.world-mvp__reclaim-feedback p { margin:5px 0; }
.world-mvp__reclaim-feedback ul { margin:5px 0 0; padding-left:17px; color:#f4c4bb; }
.world-mvp__save-status { color:#a9bbb3; font-size:10px; }
.world-mvp .world-mvp__save-button { border-color:#8fbea0; color:#14251c; background:#a5c9b1; font-weight:700; }
.world-mvp a,.world-mvp button { border:1px solid rgba(255,255,255,.13); border-radius:7px; padding:8px 10px; color:#dce7e3; background:rgba(255,255,255,.06); text-decoration:none; cursor:pointer; font:inherit; font-size:11px; }
.world-mvp button:hover,.world-mvp a:hover { border-color:#a5c9b1; background:rgba(165,201,177,.13); }
.world-mvp button:disabled { opacity:.35; cursor:not-allowed; }
.world-mvp__placement-status.is-blocked { color:#ff918b; }
.world-mvp__panel { position:absolute; z-index:2; top:78px; left:14px; bottom:48px; width:290px; overflow:auto; padding:0 14px 14px; border:1px solid rgba(255,255,255,.1); border-radius:11px; background:rgba(16,27,34,.91); box-shadow:0 14px 42px rgba(0,0,0,.22); backdrop-filter:blur(16px); }
.world-mvp__panel section { padding:15px 0; border-bottom:1px solid rgba(255,255,255,.09); }
.world-mvp__world-size { display:flex; align-items:center; justify-content:space-between; margin:8px 0; padding:9px; border:1px solid rgba(165,201,177,.22); border-radius:7px; background:rgba(165,201,177,.05); }
.world-mvp__world-size span,.world-mvp__world-note { color:#9eafad; font-size:10px; }
.world-mvp__world-size strong { color:#c6e4ce; font-size:13px; font-variant-numeric:tabular-nums; }
.world-mvp__expand-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; align-items:center; }
.world-mvp__expand-grid button { padding:8px 3px; font-size:10px; }
.world-mvp__world-center { text-align:center; color:#c6e4ce; font-size:10px; }
.world-mvp__world-note { display:block; margin-top:8px; line-height:1.5; }
.world-mvp__panel h2 { margin:0 0 12px; font-size:12px; }
.world-mvp__model-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:6px; }
.world-mvp .world-mvp__demo-button { width:100%; margin-top:7px; border-color:rgba(165,201,177,.45); color:#c6e4ce; }
.world-mvp__selected-context { margin-top:10px; padding:10px; border:1px solid rgba(165,201,177,.32); border-radius:8px; background:rgba(165,201,177,.055); }
.world-mvp__selected-heading span,.world-mvp__selected-heading strong { display:block; }
.world-mvp__selected-heading span { color:#8e9fa3; font-size:10px; }
.world-mvp__selected-heading strong { margin-top:5px; color:#e5efe8; font-size:12px; overflow-wrap:anywhere; }
.world-mvp__selected-context .world-mvp__message { min-height:0; margin:7px 0; }
.world-mvp__primary-actions { grid-template-columns:repeat(2,minmax(0,1fr)); }
.world-mvp__primary-actions button:last-child { grid-column:1 / -1; }
.world-mvp__transform-actions { grid-template-columns:repeat(2,minmax(0,1fr)); }
.world-mvp__secondary-actions { grid-template-columns:repeat(2,minmax(0,1fr)); }
.world-mvp__empty-selection { margin:10px 0 0; padding:10px; border:1px dashed rgba(255,255,255,.14); border-radius:7px; color:#9eafad; font-size:10px; line-height:1.6; }
.world-mvp__tools { display:grid; grid-template-columns:repeat(3,1fr); gap:5px; margin-top:8px; }
.world-mvp__operation-panel { min-height:100%; }
.world-mvp__operation-name { display:block; margin:5px 0 10px; color:#e5efe8; font-size:13px; overflow-wrap:anywhere; }
.world-mvp__operation-panel .world-mvp__message { margin:8px 0 12px; line-height:1.65; }
.world-mvp__footprint-info { display:grid; gap:5px; margin:12px 0; padding:10px; border:1px solid rgba(165,201,177,.28); border-radius:8px; background:rgba(165,201,177,.07); }
.world-mvp__footprint-info span { color:#aabbb4; font-size:10px; }
.world-mvp__footprint-info strong { color:#c6e4ce; font-size:14px; font-variant-numeric:tabular-nums; }
.world-mvp__footprint-info small { color:#81958d; font-size:9px; }
.world-mvp__placement-status { margin:12px 0; color:#c6e4ce; font-size:10px; line-height:1.6; }
.world-mvp__placement-actions { grid-template-columns:repeat(2,minmax(0,1fr)); }
.world-mvp__placement-expand { margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,.09); }
.world-mvp__placement-expand > span { display:block; margin-bottom:8px; color:#aabbb4; font-size:10px; }
.world-mvp__placement-expand .world-mvp__expand-grid button { padding:6px 3px; }
.world-mvp__placement-actions button:first-child { grid-column:1 / -1; border-color:#8fbea0; color:#14251c; background:#a5c9b1; font-weight:700; }
.world-mvp__placement-actions button:disabled { color:#dce7e3; background:rgba(255,255,255,.06); }
.world-mvp__placement { margin-top:9px; padding:10px; border:1px solid rgba(165,201,177,.35); border-radius:8px; background:rgba(165,201,177,.08); }
.world-mvp__placement strong { display:block; color:#c6e4ce; font-size:11px; }
.world-mvp__placement p { margin:7px 0; color:#b4c1c1; font-size:10px; line-height:1.55; }
.world-mvp__placement .world-mvp__tools { grid-template-columns:repeat(2,1fr); }
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
  .world-mvp__header-actions { gap:5px; overflow-x:auto; }
  .world-mvp__view-switch button { padding:5px 6px; font-size:9px; }
  .world-mvp__panel { top:auto; left:8px; right:8px; bottom:8px; width:auto; max-height:52vh; padding:0 12px 10px; }
  .world-mvp__help { display:none; }
  .world-mvp__chunk-manager { top:62px; right:8px; width:calc(100vw - 16px); max-height:45vh; padding:10px; }
  .world-mvp__chunk-manager-actions { gap:5px; }
  .world-mvp__chunk-manager-actions button { padding:7px 8px; font-size:10px; }
}
</style>
