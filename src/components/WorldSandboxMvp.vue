<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { createCampusScene } from '../three/world/campus/createCampusScene.js'
import { createObjectSculptModel } from '../three/reconstruction/createObjectSculptModel.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'

const viewport = ref(null)
const selectedName = ref('')
const objects = ref([])
const command = ref('')
const aiPrompt = ref('')
const aiModificationPrompt = ref('')
const aiBusy = ref(false)
const message = ref('沙盒已就绪。创建一个模型，或输入任务指令。')
const time = ref(14)
const weather = ref('clear')
const wind = ref(20)
const transformMode = ref('translate')
const objectTypes = [
  { id: 'box', label: '立方体' },
  { id: 'sphere', label: '球体' },
  { id: 'cylinder', label: '圆柱体' },
  { id: 'cone', label: '圆锥体' },
  { id: 'torus', label: '环形体' },
]
let scene
let camera
let renderer
let orbit
let transform
let sun
let ambient
let hemisphere
let ground
let campusRoot
let weatherPoints
let animationFrame
let resizeObserver
let selected = null
let disposed = false
let objectId = 0
const objectsById = new Map()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const clock = new THREE.Clock()

function syncObjects() {
  objects.value = [...objectsById.values()].map(object => ({ id: object.userData.id, name: object.name }))
  selectedName.value = selected?.name || ''
}

function registerModel(root, name) {
  root.name = name || root.name || '模型'
  root.userData.id = String(++objectId)
  root.userData.isSandboxModel = true
  root.position.x += (Math.random() - 0.5) * 3
  root.position.z += (Math.random() - 0.5) * 3
  root.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true } })
  scene.add(root)
  objectsById.set(root.userData.id, root)
  selectModel(root)
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
  const geometry = (geometries[type] || geometries.box)()
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random(), 0.42, 0.56),
    roughness: 0.68,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = (objectTypes.find(item => item.id === type)?.label || '模型') + ' ' + (objectId + 1)
  mesh.position.set(0, type === 'torus' ? 1.4 : 1, 0)
  registerModel(mesh, mesh.name)
}

function selectModel(object) {
  selected = object || null
  if (selected) transform.attach(selected)
  else transform.detach()
  syncObjects()
}

function selectFromPointer(event) {
  if (transform.dragging) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects([...objectsById.values()], true)
  if (!hits.length) {
    selectModel(null)
    return
  }
  let object = hits[0].object
  while (object && !object.userData.isSandboxModel) object = object.parent
  selectModel(object)
}

function setMode(mode) {
  transformMode.value = mode
  transform?.setMode(mode)
}

function deleteSelected() {
  if (!selected) return
  const target = selected
  transform.detach()
  scene.remove(target)
  objectsById.delete(target.userData.id)
  target.traverse(node => {
    node.geometry?.dispose?.()
    if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.())
    else node.material?.dispose?.()
  })
  selected = null
  syncObjects()
  message.value = '已删除模型'
}

async function generateAiModel() {
  const prompt = aiPrompt.value.trim()
  if (!prompt || aiBusy.value) return
  aiBusy.value = true
  message.value = '正在调用视觉模型生成独立建模组…'
  try {
    const response = await fetch(API_BASE + '/assets/ai-image/generate-object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({ prompt, objectType: '独立 3D 模型', visualStyle: 'stylized' }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || '模型生成失败：HTTP ' + response.status)
    const spec = payload.data || payload.result || payload
    const group = createObjectSculptModel(THREE, spec, { source: 'world-sandbox-ai' })
    registerModel(group, spec.targetName || 'AI 建模组 ' + (objectId + 1))
    aiPrompt.value = ''
  } catch (error) {
    message.value = 'AI 建模失败：' + (error?.message || '未知错误')
  } finally {
    aiBusy.value = false
  }
}

async function modifyAiModel() {
  if (!selected || !aiModificationPrompt.value.trim() || aiBusy.value) return
  const spec = selected.userData.objectSculptSpec
  if (!spec) { message.value = '当前选中对象不是 AI 建模组，暂不支持 AI 修改'; return }
  aiBusy.value = true
  message.value = '正在根据指令修改建模组…'
  try {
    const response = await fetch(API_BASE + '/assets/ai-image/modify-object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({ objectSculptSpec: spec, selectedNodeIds: [], instruction: aiModificationPrompt.value.trim() }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || '模型修改失败：HTTP ' + response.status)
    const result = payload.data || payload.result || payload
    const nextSpec = result.objectSculptSpec || result.spec || result
    const replacement = createObjectSculptModel(THREE, nextSpec, { source: 'world-sandbox-ai-edit' })
    replacement.position.copy(selected.position)
    replacement.rotation.copy(selected.rotation)
    replacement.scale.copy(selected.scale)
    const old = selected
    transform.detach()
    scene.remove(old)
    old.traverse(node => { node.geometry?.dispose?.(); if (Array.isArray(node.material)) node.material.forEach(item => item.dispose?.()); else node.material?.dispose?.() })
    objectsById.delete(old.userData.id)
    registerModel(replacement, nextSpec.targetName || old.name)
    aiModificationPrompt.value = ''
  } catch (error) {
    message.value = 'AI 修改失败：' + (error?.message || '未知错误')
  } finally {
    aiBusy.value = false
  }
}

function updateEnvironment() {
  if (!scene) return
  const hour = Number(time.value)
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI))
  const angle = ((hour - 6) / 24) * Math.PI * 2
  sun.position.set(Math.cos(angle) * 35, Math.max(3, daylight * 42), Math.sin(angle) * 35)
  sun.intensity = 0.12 + daylight * 2.1
  hemisphere.intensity = 0.2 + daylight * 1.3
  ambient.intensity = 0.1 + daylight * 0.4
  const night = daylight < 0.12
  const sky = night ? new THREE.Color('#111a30') : new THREE.Color('#b8d2df').lerp(new THREE.Color('#f1c99d'), 1 - daylight)
  if (weather.value === 'cloudy' || weather.value === 'rain') sky.lerp(new THREE.Color('#788995'), 0.45)
  if (weather.value === 'fog') sky.lerp(new THREE.Color('#cbd3d1'), 0.55)
  scene.background = sky
  scene.fog.color.copy(sky)
  scene.fog.near = weather.value === 'fog' ? 5 : weather.value === 'rain' ? 22 : 48
  scene.fog.far = weather.value === 'fog' ? 58 : weather.value === 'rain' ? 120 : 210
  sun.color.set(weather.value === 'clear' ? '#fff0d2' : '#d0dce2')
  if (ground?.material) ground.material.color.set(weather.value === 'snow' ? '#dce4e5' : weather.value === 'rain' ? '#657d78' : '#879b79')
  updateWeather()
}

function updateWeather() {
  if (weatherPoints) {
    scene.remove(weatherPoints)
    weatherPoints.geometry.dispose()
    weatherPoints.material.dispose()
    weatherPoints = null
  }
  if (!['rain', 'snow'].includes(weather.value)) return
  const count = weather.value === 'rain' ? 1500 : 850
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 90
    positions[i * 3 + 1] = Math.random() * 35
    positions[i * 3 + 2] = (Math.random() - 0.5) * 90
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: '#e9f2f5',
    size: weather.value === 'rain' ? 0.075 : 0.15,
    transparent: true,
    opacity: 0.72,
  })
  weatherPoints = new THREE.Points(geometry, material)
  scene.add(weatherPoints)
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
  else if (/雪|snow/i.test(text)) { weather.value = 'snow'; updateEnvironment(); message.value = '环境已切换为雪天' }
  else if (/雾|fog/i.test(text)) { weather.value = 'fog'; updateEnvironment(); message.value = '环境已切换为雾天' }
  else if (/多云|阴天|cloud/i.test(text)) { weather.value = 'cloudy'; updateEnvironment(); message.value = '环境已切换为多云' }
  else if (/晴天|放晴|clear/i.test(text)) { weather.value = 'clear'; updateEnvironment(); message.value = '环境已切换为晴天' }
  else if (/(时间|time)[^0-9]*(\d{1,2})/i.test(text)) {
    const hour = Number(text.match(/(?:时间|time)[^0-9]*(\d{1,2})/i)[1])
    time.value = Math.min(24, Math.max(0, hour))
    updateEnvironment()
    message.value = '时间已调整为 ' + time.value + ':00'
  } else if (/删除|delete/i.test(text)) deleteSelected()
  else if (/复制|duplicate/i.test(text)) {
    if (!selected) message.value = '请先选择一个模型'
    else {
      const copy = selected.clone(true)
      copy.traverse(node => { if (node.geometry) node.geometry = node.geometry.clone(); if (Array.isArray(node.material)) node.material = node.material.map(item => item.clone()); else if (node.material) node.material = node.material.clone() })
      copy.name = selected.name + ' 副本'
      copy.userData = { ...selected.userData, id: String(objectId + 1) }
      copy.position.x += 3
      registerModel(copy, copy.name)
      message.value = '已复制模型'
    }
  } else if (/移动|move/i.test(text)) {
    const match = text.match(/(-?\d+(?:\.\d+)?)[,，\s]+(-?\d+(?:\.\d+)?)[,，\s]+(-?\d+(?:\.\d+)?)/)
    if (!selected) message.value = '请先选择一个模型'
    else if (!match) message.value = '移动指令格式：移动 2,0,3'
    else {
      selected.position.set(Number(match[1]), Number(match[2]), Number(match[3]))
      message.value = '模型已移动到指定坐标'
    }
  } else if (/旋转|rotate/i.test(text)) {
    const degrees = Number((text.match(/-?\d+(?:\.\d+)?/) || [0])[0])
    if (!selected) message.value = '请先选择一个模型'
    else {
      selected.rotation.y += THREE.MathUtils.degToRad(degrees)
      message.value = '模型已旋转 ' + degrees + '°'
    }
  } else if (/交互|触发|interact/i.test(text)) {
    if (!selected) message.value = '请先选择一个模型'
    else {
      selected.scale.multiplyScalar(1.12)
      message.value = '已触发模型交互：' + selected.name
    }
  } else message.value = '暂不支持该指令。试试：创建球体、移动 2,0,3、旋转 45、切换雨天、时间 18 点、触发交互。'
  command.value = ''
  syncObjects()
}

function animate() {
  if (disposed) return
  animationFrame = requestAnimationFrame(animate)
  const delta = Math.min(clock.getDelta(), 0.05)
  if (weatherPoints) {
    const positions = weatherPoints.geometry.attributes.position
    const snow = weather.value === 'snow'
    for (let i = 0; i < positions.count; i++) {
      let y = positions.getY(i) - delta * (snow ? 2.1 : 18)
      let x = positions.getX(i) + delta * Number(wind.value) / 100 * (snow ? 1.8 : 6)
      if (y < 0) { y = 25 + Math.random() * 10; x = (Math.random() - 0.5) * 90 }
      if (x > 45) x = -45
      positions.setXYZ(i, x, y, positions.getZ(i))
    }
    positions.needsUpdate = true
  }
  orbit.update()
  renderer.render(scene, camera)
}

function resize() {
  if (!renderer || !viewport.value) return
  const width = Math.max(1, viewport.value.clientWidth)
  const height = Math.max(1, viewport.value.clientHeight)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

onMounted(() => {
  const width = Math.max(1, viewport.value.clientWidth)
  const height = Math.max(1, viewport.value.clientHeight)
  scene = new THREE.Scene()
  campusRoot = createCampusScene(THREE)
  scene.add(campusRoot)
  scene.background = new THREE.Color('#b8d2df')
  scene.fog = new THREE.Fog('#b8d2df', 48, 210)
  camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000)
  camera.position.set(118, 96, 132)
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  viewport.value.appendChild(renderer.domElement)

  orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true
  orbit.target.set(0, 0, 0)
  transform = new TransformControls(camera, renderer.domElement)
  transform.addEventListener('dragging-changed', event => { orbit.enabled = !event.value })
  scene.add(transform.getHelper())

  hemisphere = new THREE.HemisphereLight(0xddeeff, 0x53604d, 1.5)
  scene.add(hemisphere)
  sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(20, 30, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  scene.add(sun)
  ambient = new THREE.AmbientLight(0xffffff, 0.35)
  scene.add(ambient)

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ color: '#879b79', roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.visible = false
  scene.add(ground)
  const grid = new THREE.GridHelper(300, 120, '#61715f', '#aab6a0')
  grid.position.y = 0.012
  grid.visible = false
  scene.add(grid)

  renderer.domElement.addEventListener('pointerdown', selectFromPointer)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(viewport.value)
  updateEnvironment()
  animate()
})

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  renderer?.domElement.removeEventListener('pointerdown', selectFromPointer)
  transform?.dispose()
  orbit?.dispose()
  for (const object of objectsById.values()) {
    object.geometry?.dispose()
    object.material?.dispose()
  }
  weatherPoints?.geometry.dispose()
  weatherPoints?.material.dispose()
  ground?.geometry.dispose()
  ground?.material.dispose()
  renderer?.dispose()
  if (renderer?.domElement.parentNode === viewport.value) viewport.value.removeChild(renderer.domElement)
})
</script>

<template>
  <main class="world-mvp">
    <div ref="viewport" class="world-mvp__viewport"></div>
    <header class="world-mvp__header">
      <div class="world-mvp__brand"><strong>WORLD SANDBOX</strong><span>南昌工学院校园场景 · AI 独立建模组</span></div>
      <a href="/">返回地图</a>
    </header>

    <aside class="world-mvp__panel">
      <section>
        <h2>AI 建模</h2>
        <div class="world-mvp__command">
          <input v-model="aiPrompt" placeholder="描述要生成的模型，例如：一座现代图书馆" @keydown.enter="generateAiModel">
          <button :disabled="aiBusy || !aiPrompt.trim()" @click="generateAiModel">{{ aiBusy ? '生成中' : '生成' }}</button>
        </div>
        <div class="world-mvp__command" style="margin-top:7px">
          <input v-model="aiModificationPrompt" placeholder="修改当前 AI 建模组，例如：增加玻璃幕墙" @keydown.enter="modifyAiModel">
          <button :disabled="aiBusy || !aiModificationPrompt.trim() || !selected?.userData.objectSculptSpec" @click="modifyAiModel">修改</button>
        </div>
        <p class="world-mvp__message">生成结果作为独立建模组加入场景，可整体移动、旋转、缩放和复制。</p>
      </section>
      <section>
        <h2>基础模型</h2>
        <div class="world-mvp__model-grid">
          <button v-for="item in objectTypes" :key="item.id" @click="addModel(item.id)">＋ {{ item.label }}</button>
        </div>
        <div class="world-mvp__selected">
          <span>当前对象</span><strong>{{ selectedName || '未选择' }}</strong>
          <button :disabled="!selectedName" @click="deleteSelected">删除</button>
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
            <option value="clear">晴天</option><option value="cloudy">多云</option><option value="rain">下雨</option><option value="snow">下雪</option><option value="fog">雾天</option>
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
    <footer class="world-mvp__help">左键选择对象 · 右键旋转视角 · 滚轮缩放 · 拖动坐标轴操控模型</footer>
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
.world-mvp__selected { display:grid; grid-template-columns:1fr auto; align-items:center; gap:6px; margin-top:10px; padding:9px; border:1px solid rgba(255,255,255,.1); border-radius:7px; }
.world-mvp__selected span { color:#8e9fa3; font-size:10px; }
.world-mvp__selected strong { grid-column:1; font-size:11px; }
.world-mvp__selected button { grid-column:2; grid-row:1 / span 2; }
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
