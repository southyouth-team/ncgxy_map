<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { SandboxRuntime } from './runtime/SandboxRuntime.js'

const viewport = ref(null)
const runtime = ref(null)
const ready = ref(false)
const selectedObject = ref(null)
const objects = ref([])
const environment = ref({ time: 14, weather: 'clear', wind: 0.2 })
const taskCommand = ref('')
const taskResult = ref('任务运行时已就绪。可输入自然语言式短指令控制环境和选中模型。')
const importInput = ref(null)
const documentInput = ref(null)
const transformMode = ref('translate')
const weatherOptions = [
  { value: 'clear', label: '晴天' },
  { value: 'cloudy', label: '多云' },
  { value: 'rain', label: '下雨' },
  { value: 'snow', label: '下雪' },
  { value: 'fog', label: '雾天' },
]
const selectedName = computed(() => selectedObject.value?.name || '未选择模型')

function refreshObjects() {
  objects.value = runtime.value ? [...runtime.value.objects.values()].map(object => ({
    id: object.userData.objectId,
    name: object.name || '未命名模型',
  })) : []
}
function handleSelect(object) {
  selectedObject.value = object
  refreshObjects()
}
function addPrimitive(type) {
  runtime.value?.addPrimitive(type)
  refreshObjects()
}
function setEnvironment() {
  runtime.value?.applyEnvironment(environment.value)
}
function setMode(mode) {
  transformMode.value = mode
  runtime.value?.setTransformMode(mode)
}
function selectObject(id) {
  const object = runtime.value?.objects.get(id)
  if (object) runtime.value.select(object)
}
function deleteSelected() {
  runtime.value?.deleteSelected()
  refreshObjects()
}
function duplicateSelected() {
  runtime.value?.duplicateSelected()
  refreshObjects()
}
async function importModel(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    await runtime.value.importFile(file)
    taskResult.value = '模型已导入：' + file.name
    refreshObjects()
  } catch (error) {
    taskResult.value = '模型导入失败：' + (error?.message || '未知错误')
  }
}
function downloadText(filename, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
function saveDocument() {
  if (!runtime.value) return
  downloadText('sandbox-scene.json', runtime.value.serialize())
  taskResult.value = '场景文档已导出。重新打开沙盒后可通过“导入场景”恢复。'
}
async function loadDocument(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    await runtime.value.loadDocument(await file.text())
    environment.value = { ...runtime.value.environment }
    refreshObjects()
    taskResult.value = '场景文档已载入：' + file.name
  } catch (error) {
    taskResult.value = '场景文档载入失败：' + (error?.message || '文件格式不正确')
  }
}
async function runTask() {
  const result = await runtime.value?.runTask(taskCommand.value)
  taskResult.value = result || '任务未执行'
  taskCommand.value = ''
  environment.value = { ...runtime.value.environment }
  refreshObjects()
}
function onTaskKeydown(event) {
  if (event.key === 'Enter') runTask()
}
function focusSelected() {
  if (!selectedObject.value || !runtime.value) return
  const box = new (runtime.value.camera.position.constructor)()
  selectedObject.value.getWorldPosition(box)
  runtime.value.orbit.target.copy(box)
}

onMounted(() => {
  runtime.value = new SandboxRuntime(viewport.value, handleSelect).init()
  ready.value = true
  refreshObjects()
})
onBeforeUnmount(() => {
  runtime.value?.dispose()
  runtime.value = null
})
</script>

<template>
  <main class="sandbox">
    <div ref="viewport" class="sandbox__viewport"></div>
    <header class="sandbox__topbar">
      <div class="sandbox__brand">
        <span class="sandbox__brand-mark">3D</span>
        <div><strong>通用 3D 沙盒</strong><small>WORLD SANDBOX · MVP</small></div>
      </div>
      <div class="sandbox__top-actions">
        <span class="sandbox__status"><i></i>{{ ready ? '运行中' : '初始化中' }}</span>
        <button @click="saveDocument">导出场景</button>
        <button @click="documentInput?.click()">导入场景</button>
        <a href="/">返回校园地图</a>
        <input ref="documentInput" class="sandbox__hidden" type="file" accept=".json,application/json" @change="loadDocument">
      </div>
    </header>

    <aside class="sandbox__sidebar">
      <section class="sandbox__section">
        <div class="sandbox__section-title"><span>01</span> 创建与导入模型</div>
        <div class="sandbox__primitive-grid">
          <button @click="addPrimitive('box')"><b>立方体</b><small>Box</small></button>
          <button @click="addPrimitive('sphere')"><b>球体</b><small>Sphere</small></button>
          <button @click="addPrimitive('cylinder')"><b>圆柱</b><small>Cylinder</small></button>
          <button @click="addPrimitive('cone')"><b>圆锥</b><small>Cone</small></button>
          <button @click="addPrimitive('torus')"><b>环形体</b><small>Torus</small></button>
          <button @click="importInput?.click()"><b>导入模型</b><small>GLB / glTF</small></button>
        </div>
        <input ref="importInput" class="sandbox__hidden" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" @change="importModel">
        <p class="sandbox__hint">可直接创建基础几何体，也可导入外部 GLB / glTF。建议使用自包含 GLB 文件。</p>
      </section>

      <section class="sandbox__section">
        <div class="sandbox__section-title"><span>02</span> 模型对象</div>
        <div class="sandbox__selected">
          <small>当前选中</small><strong>{{ selectedName }}</strong>
          <div class="sandbox__object-actions">
            <button :disabled="!selectedObject" @click="duplicateSelected">复制</button>
            <button :disabled="!selectedObject" @click="focusSelected">聚焦</button>
            <button class="danger" :disabled="!selectedObject" @click="deleteSelected">删除</button>
          </div>
        </div>
        <div v-if="objects.length" class="sandbox__object-list">
          <button v-for="object in objects" :key="object.id" :class="{ active: selectedObject?.userData.objectId === object.id }" @click="selectObject(object.id)">
            <span class="sandbox__object-dot"></span><span>{{ object.name }}</span>
          </button>
        </div>
        <p v-else class="sandbox__empty">场景中还没有模型</p>
        <div class="sandbox__transform">
          <button :class="{ active: transformMode === 'translate' }" :disabled="!selectedObject" @click="setMode('translate')">移动</button>
          <button :class="{ active: transformMode === 'rotate' }" :disabled="!selectedObject" @click="setMode('rotate')">旋转</button>
          <button :class="{ active: transformMode === 'scale' }" :disabled="!selectedObject" @click="setMode('scale')">缩放</button>
        </div>
      </section>

      <section class="sandbox__section">
        <div class="sandbox__section-title"><span>03</span> 环境控制</div>
        <label class="sandbox__field"><span>时间 <b>{{ String(Math.floor(environment.time)).padStart(2, '0') }}:{{ String(Math.round((environment.time % 1) * 60)).padStart(2, '0') }}</b></span>
          <input v-model.number="environment.time" type="range" min="0" max="24" step="0.25" @input="setEnvironment">
        </label>
        <label class="sandbox__field"><span>天气</span>
          <select v-model="environment.weather" @change="setEnvironment">
            <option v-for="option in weatherOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label class="sandbox__field"><span>风力 <b>{{ Math.round(environment.wind * 100) }}%</b></span>
          <input v-model.number="environment.wind" type="range" min="0" max="1" step="0.05" @input="setEnvironment">
        </label>
        <p class="sandbox__hint">时间连续影响太阳方向与光照；天气影响天空、雾效和降水粒子。风力影响降水运动。</p>
      </section>

      <section class="sandbox__section sandbox__task-section">
        <div class="sandbox__section-title"><span>04</span> 任务交互</div>
        <div class="sandbox__task-input">
          <input v-model="taskCommand" placeholder="例如：移动 3,0,2 / 切换雨天" @keydown="onTaskKeydown">
          <button @click="runTask">执行</button>
        </div>
        <p class="sandbox__task-result">{{ taskResult }}</p>
        <div class="sandbox__examples">
          <button @click="taskCommand = '切换雨天'; runTask()">下雨</button>
          <button @click="taskCommand = '时间 18 点'; runTask()">傍晚</button>
          <button @click="taskCommand = '旋转 45'; runTask()">旋转 45°</button>
          <button @click="taskCommand = '触发交互'; runTask()">触发交互</button>
        </div>
        <p class="sandbox__hint">当前任务运行时支持环境切换、对象移动/旋转、复制/删除和交互触发。它是本地动作执行器，不代表已接入 AI Agent。</p>
      </section>
    </aside>

    <div class="sandbox__help">
      <span>鼠标左键选择模型</span><span>右键旋转视角</span><span>滚轮缩放</span><span>拖拽控制轴调整模型</span>
    </div>
  </main>
</template>

<style scoped>
.sandbox { position:relative; width:100%; height:100vh; min-height:640px; overflow:hidden; color:#e7edf2; background:#111a22; font-family:Inter,"Microsoft YaHei",sans-serif; }
.sandbox__viewport { position:absolute; inset:0; }
.sandbox__viewport :deep(canvas) { display:block; width:100%; height:100%; }
.sandbox__topbar { position:absolute; z-index:3; inset:0 0 auto; height:64px; display:flex; align-items:center; justify-content:space-between; padding:0 22px; border-bottom:1px solid rgba(255,255,255,.09); background:rgba(12,20,27,.78); backdrop-filter:blur(16px); }
.sandbox__brand,.sandbox__top-actions { display:flex; align-items:center; gap:12px; }
.sandbox__brand-mark { display:grid; place-items:center; width:34px; height:34px; border-radius:9px; background:#b6d4c0; color:#183326; font-size:13px; font-weight:900; }
.sandbox__brand strong,.sandbox__brand small { display:block; }
.sandbox__brand strong { font-size:14px; }
.sandbox__brand small { margin-top:3px; color:#84949e; font-size:9px; letter-spacing:1.1px; }
.sandbox__top-actions { gap:8px; }
.sandbox button,.sandbox a { border:1px solid rgba(255,255,255,.13); border-radius:7px; padding:8px 11px; color:#dce6e9; background:rgba(255,255,255,.06); text-decoration:none; cursor:pointer; font:inherit; font-size:11px; }
.sandbox button:hover,.sandbox a:hover { border-color:#9fc6ac; background:rgba(159,198,172,.13); }
.sandbox button:disabled { opacity:.35; cursor:not-allowed; }
.sandbox__status { display:flex; align-items:center; gap:7px; margin-right:8px; color:#aab8bd; font-size:11px; }
.sandbox__status i { width:7px; height:7px; border-radius:50%; background:#78c995; box-shadow:0 0 10px #78c995; }
.sandbox__sidebar { position:absolute; z-index:2; top:82px; left:16px; bottom:54px; width:326px; overflow:auto; padding:0 15px 15px; border:1px solid rgba(255,255,255,.1); border-radius:12px; background:rgba(17,27,35,.9); box-shadow:0 16px 48px rgba(0,0,0,.25); backdrop-filter:blur(18px); }
.sandbox__section { padding:16px 0; border-bottom:1px solid rgba(255,255,255,.09); }
.sandbox__section:last-child { border:0; }
.sandbox__section-title { display:flex; align-items:center; gap:9px; margin-bottom:13px; font-size:12px; font-weight:750; }
.sandbox__section-title span { color:#9fc6ac; font-size:10px; letter-spacing:.7px; }
.sandbox__primitive-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
.sandbox__primitive-grid button { min-height:56px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:4px; padding:8px; }
.sandbox__primitive-grid b { font-size:11px; }
.sandbox__primitive-grid small { color:#84949e; font-size:9px; }
.sandbox__hint { margin:10px 0 0; color:#85949d; font-size:10px; line-height:1.65; }
.sandbox__selected { padding:10px; border:1px solid rgba(255,255,255,.1); border-radius:8px; background:rgba(255,255,255,.035); }
.sandbox__selected small,.sandbox__selected strong { display:block; }
.sandbox__selected small { color:#84949e; font-size:10px; }
.sandbox__selected strong { margin-top:5px; font-size:12px; }
.sandbox__object-actions { display:flex; gap:6px; margin-top:10px; }
.sandbox__object-actions button { flex:1; padding:6px; }
.sandbox .danger { color:#e9a5a0; }
.sandbox__object-list { display:grid; gap:4px; max-height:115px; overflow:auto; margin-top:9px; }
.sandbox__object-list button { display:flex; align-items:center; gap:8px; border-color:transparent; text-align:left; }
.sandbox__object-list button.active { border-color:rgba(159,198,172,.5); background:rgba(159,198,172,.12); }
.sandbox__object-list button span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sandbox__object-dot { width:6px; height:6px; flex:0 0 auto; border-radius:50%; background:#9fc6ac; }
.sandbox__empty { color:#84949e; font-size:10px; }
.sandbox__transform { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:10px; }
.sandbox__transform button.active { border-color:#9fc6ac; color:#bfe0c9; background:rgba(159,198,172,.16); }
.sandbox__field { display:grid; gap:8px; margin:12px 0; color:#aebbc1; font-size:11px; }
.sandbox__field > span { display:flex; justify-content:space-between; }
.sandbox__field b { color:#d9e6dc; font-weight:600; }
.sandbox__field input[type="range"] { width:100%; accent-color:#9fc6ac; }
.sandbox__field select { width:100%; padding:8px; border:1px solid rgba(255,255,255,.13); border-radius:7px; color:#e0e8e9; background:#1d2a33; font:inherit; }
.sandbox__task-input { display:flex; gap:6px; }
.sandbox__task-input input { min-width:0; flex:1; padding:9px; border:1px solid rgba(255,255,255,.13); border-radius:7px; outline:none; color:#edf3f2; background:#1b2932; font:inherit; font-size:11px; }
.sandbox__task-input button { border-color:#9fc6ac; color:#172c20; background:#9fc6ac; font-weight:700; }
.sandbox__task-result { min-height:32px; color:#c2d3c9; font-size:10px; line-height:1.6; }
.sandbox__examples { display:flex; flex-wrap:wrap; gap:5px; }
.sandbox__examples button { padding:5px 7px; color:#a9bbb1; font-size:9px; }
.sandbox__help { position:absolute; z-index:1; right:18px; bottom:16px; display:flex; flex-wrap:wrap; gap:7px; }
.sandbox__help span { padding:7px 9px; border:1px solid rgba(255,255,255,.1); border-radius:6px; color:#d3dddf; background:rgba(16,26,34,.72); font-size:10px; backdrop-filter:blur(8px); }
.sandbox__hidden { display:none; }
@media(max-width:700px) {
  .sandbox__topbar { height:56px; padding:0 10px; }
  .sandbox__top-actions { gap:4px; }
  .sandbox__top-actions button,.sandbox__top-actions a { padding:7px; font-size:9px; }
  .sandbox__status { display:none; }
  .sandbox__sidebar { top:68px; left:8px; bottom:8px; width:min(310px,calc(100vw - 32px)); max-height:65vh; }
  .sandbox__help { display:none; }
}
</style>
