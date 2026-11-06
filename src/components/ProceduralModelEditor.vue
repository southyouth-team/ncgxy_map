<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const props = defineProps({
  model: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['close', 'edit', 'parameter-change', 'part-select'])
const canvasHost = ref(null)
const instruction = ref('')
const selectedPartId = ref('')
const selectedPartName = ref('整体模型')
const parameterValues = ref({})
const previewParts = computed(() => props.model?.userData?.proceduralModelParts || [])
const parameters = computed(() => props.model?.userData?.proceduralModelParameters || [])

let renderer = null
let scene = null
let camera = null
let controls = null
let previewRoot = null
let resizeObserver = null
let raycaster = null
let pointer = new THREE.Vector2()
let frame = 0

function syncPreview() {
  if (!scene || !props.model) return
  if (previewRoot) {
    scene.remove(previewRoot)
    previewRoot = null
  }
  previewRoot = props.model.clone(true)
  previewRoot.position.set(0, 0, 0)
  previewRoot.rotation.set(0, 0, 0)
  previewRoot.scale.set(1, 1, 1)
  scene.add(previewRoot)
  const box = new THREE.Box3().setFromObject(previewRoot)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  previewRoot.position.sub(center)
  const maxSize = Math.max(size.x, size.y, size.z, 1)
  camera.position.set(maxSize * 1.8, maxSize * 1.35, maxSize * 1.8)
  camera.near = Math.max(0.01, maxSize / 1000)
  camera.far = maxSize * 100
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()
  parameterValues.value = { ...(props.model.userData.proceduralModelParameterValues || {}) }
  selectedPartId.value = ''
  selectedPartName.value = '整体模型'
  frame = requestAnimationFrame(render)
}
function resize() {
  if (!renderer || !canvasHost.value) return
  const width = Math.max(1, canvasHost.value.clientWidth)
  const height = Math.max(1, canvasHost.value.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  render()
}
function render() {
  if (!renderer || !scene || !camera) return
  controls?.update()
  renderer.render(scene, camera)
  frame = requestAnimationFrame(render)
}
function selectPart(event) {
  if (!renderer || !previewRoot) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObject(previewRoot, true)[0]
  if (!hit) {
    selectedPartId.value = ''
    selectedPartName.value = '整体模型'
    emit('part-select', '')
    return
  }
  let part = hit.object
  while (part && part !== previewRoot && !part.userData?.componentId) part = part.parent
  selectedPartId.value = part && part !== previewRoot ? String(part.userData.componentId) : ''
  selectedPartName.value = part && part !== previewRoot ? (part.name || selectedPartId.value) : '整体模型'
  emit('part-select', selectedPartId.value)
}
function updateParameter(parameter, value) {
  parameterValues.value = { ...parameterValues.value, [parameter.id]: value }
  emit('parameter-change', { id: parameter.id, value, values: parameterValues.value })
}
function submitEdit() {
  const text = instruction.value.trim()
  if (!text || props.busy) return
  emit('edit', { instruction: text, selectedPartId: selectedPartId.value, parameterValues: parameterValues.value })
  instruction.value = ''
}
watch(() => props.model, syncPreview)
onMounted(() => {
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#17242b')
  camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  canvasHost.value.appendChild(renderer.domElement)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x52616b, 2.1))
  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(8, 12, 10)
  key.castShadow = true
  scene.add(key)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.addEventListener('change', render)
  raycaster = new THREE.Raycaster()
  renderer.domElement.addEventListener('dblclick', selectPart)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvasHost.value)
  syncPreview()
  resize()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  renderer?.domElement?.removeEventListener('dblclick', selectPart)
  controls?.dispose()
  if (previewRoot) scene?.remove(previewRoot)
  renderer?.dispose()
  renderer?.domElement?.remove()
})
</script>

<template>
  <div class="model-editor" role="dialog" aria-modal="true" aria-label="AI 模型编辑器">
    <header class="model-editor__header">
      <div><strong>模型微调</strong><span>{{ model?.name || '程序化模型' }} · AI 对话编辑</span></div>
      <button @click="emit('close')">关闭</button>
    </header>
    <div class="model-editor__body">
      <section class="model-editor__preview">
        <div ref="canvasHost" class="model-editor__canvas"></div>
        <div class="model-editor__preview-hint">双击模型部件进行选择 · 拖动旋转 · 滚轮缩放</div>
        <div class="model-editor__part-chip">当前范围：{{ selectedPartName }}</div>
      </section>
      <section class="model-editor__controls">
        <div class="model-editor__scope">
          <button :class="{ active: !selectedPartId }" @click="selectedPartId = ''; selectedPartName = '整体模型'; emit('part-select', '')">整体模型</button>
          <span v-if="selectedPartId">{{ selectedPartName }} · {{ selectedPartId }}</span>
          <span v-else>对整个模型进行调整</span>
        </div>
        <div class="model-editor__chat">
          <h3>AI 调整对话</h3>
          <textarea v-model="instruction" rows="4" placeholder="例如：新增一个屋顶颜色控制参数，默认深蓝色；或者把选中的屋顶向外延伸 0.5 米。" @keydown.ctrl.enter="submitEdit"></textarea>
          <button class="primary" :disabled="busy || !instruction.trim()" @click="submitEdit">{{ busy ? 'AI 正在修改模型…' : '发送调整指令' }}</button>
          <p v-if="error" class="model-editor__error">{{ error }}</p>
        </div>
        <div class="model-editor__parameters">
          <div class="model-editor__section-title"><h3>模型结构参数</h3><span>由 AI 动态声明</span></div>
          <p v-if="!parameters.length" class="model-editor__empty">当前模型还没有可调参数。通过上方对话要求 AI 新增控制参数。</p>
          <label v-for="parameter in parameters" :key="parameter.id" class="model-editor__field">
            <span>{{ parameter.label || parameter.id }}<small v-if="parameter.description">{{ parameter.description }}</small></span>
            <input v-if="parameter.type === 'color'" type="color" :value="parameterValues[parameter.id] ?? parameter.default ?? '#ffffff'" @input="updateParameter(parameter, $event.target.value)">
            <input v-else-if="parameter.type === 'number'" type="number" :value="parameterValues[parameter.id] ?? parameter.default ?? 0" :min="parameter.min" :max="parameter.max" :step="parameter.step || 'any'" @change="updateParameter(parameter, Number($event.target.value))">
            <input v-else-if="parameter.type === 'boolean'" type="checkbox" :checked="Boolean(parameterValues[parameter.id] ?? parameter.default)" @change="updateParameter(parameter, $event.target.checked)">
            <select v-else-if="parameter.type === 'select'" :value="parameterValues[parameter.id] ?? parameter.default" @change="updateParameter(parameter, $event.target.value)">
              <option v-for="option in (parameter.options || [])" :key="String(option.value ?? option)" :value="option.value ?? option">{{ option.label ?? option }}</option>
            </select>
            <input v-else type="text" :value="parameterValues[parameter.id] ?? parameter.default ?? ''" @change="updateParameter(parameter, $event.target.value)">
          </label>
        </div>
        <div class="model-editor__parts">
          <h3>模型部件</h3>
          <button :class="{ active: !selectedPartId }" @click="selectedPartId = ''; selectedPartName = '整体模型'; emit('part-select', '')">整体模型</button>
          <button v-for="part in previewParts" :key="part.id" :class="{ active: selectedPartId === part.id }" @click="selectedPartId = part.id; selectedPartName = part.name || part.id; emit('part-select', part.id)">{{ part.name || part.id }}</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.model-editor { position:fixed; z-index:20; inset:3vh 3vw; display:flex; flex-direction:column; overflow:hidden; color:#eaf1ed; background:#101b22; border:1px solid rgba(255,255,255,.16); border-radius:14px; box-shadow:0 28px 100px rgba(0,0,0,.55); }
.model-editor__header { height:58px; flex:none; display:flex; align-items:center; justify-content:space-between; padding:0 18px; border-bottom:1px solid rgba(255,255,255,.1); }
.model-editor__header strong,.model-editor__header span { display:block; }.model-editor__header strong { font-size:14px; }.model-editor__header span { margin-top:4px; color:#8fa2a5; font-size:10px; }
.model-editor button { padding:8px 10px; border:1px solid rgba(255,255,255,.14); border-radius:7px; color:#dce7e3; background:#1a2931; cursor:pointer; font:inherit; font-size:11px; }
.model-editor button.active { border-color:#9fc8ad; color:#c5e3cd; background:#243c32; }
.model-editor button:disabled { opacity:.45; cursor:not-allowed; }
.model-editor__body { min-height:0; flex:1; display:grid; grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr); }
.model-editor__preview { position:relative; min-height:0; background:#17242b; border-right:1px solid rgba(255,255,255,.1); }
.model-editor__canvas { position:absolute; inset:0; }.model-editor__canvas :deep(canvas) { width:100%; height:100%; display:block; }
.model-editor__preview-hint,.model-editor__part-chip { position:absolute; left:14px; padding:8px 10px; border:1px solid rgba(255,255,255,.1); border-radius:7px; background:rgba(9,17,22,.72); font-size:10px; color:#c5d2ce; }
.model-editor__preview-hint { bottom:14px; }.model-editor__part-chip { top:14px; }
.model-editor__controls { min-height:0; overflow:auto; padding:16px; }
.model-editor__scope { display:flex; align-items:center; gap:10px; margin-bottom:14px; }.model-editor__scope span,.model-editor__section-title span { color:#92a4a5; font-size:10px; }
.model-editor__chat,.model-editor__parameters,.model-editor__parts { padding:13px 0; border-top:1px solid rgba(255,255,255,.1); }
.model-editor h3 { margin:0 0 10px; font-size:12px; }.model-editor__chat textarea,.model-editor__field input:not([type=checkbox]),.model-editor__field select { width:100%; box-sizing:border-box; padding:9px; border:1px solid rgba(255,255,255,.13); border-radius:7px; outline:none; color:#e8efed; background:#1a2931; font:inherit; font-size:11px; }
.model-editor__chat textarea { resize:vertical; line-height:1.5; }.model-editor__chat .primary { width:100%; margin-top:8px; border-color:#a5c9b1; color:#14251c; background:#a5c9b1; font-weight:700; }
.model-editor__error { color:#ffaaa1; font-size:10px; }.model-editor__empty { color:#91a2a4; font-size:11px; line-height:1.6; }
.model-editor__section-title { display:flex; align-items:center; justify-content:space-between; }.model-editor__field { display:grid; grid-template-columns:1fr minmax(110px,.8fr); align-items:center; gap:12px; margin:10px 0; color:#cbd7d2; font-size:11px; }.model-editor__field small { display:block; margin-top:4px; color:#85999a; font-size:9px; }.model-editor__field input[type=color] { width:100%; height:34px; border:0; background:transparent; }
.model-editor__parts { display:flex; flex-wrap:wrap; gap:6px; }.model-editor__parts h3 { width:100%; }
@media(max-width:760px) { .model-editor { inset:1vh 1vw; }.model-editor__body { grid-template-columns:1fr; grid-template-rows:minmax(220px,.8fr) minmax(280px,1fr); }.model-editor__preview { border-right:0; border-bottom:1px solid rgba(255,255,255,.1); } }
</style>
