<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createCampusAssetTemplateRuntime } from '../three/world/campus/createCampusAssetTemplateRuntime.js'

const viewport = ref(null), templates = ref([]), instances = ref([])
const selectedId = ref(''), selectedCategory = ref('all'), selectedInstanceId = ref('')
const scale = ref(1), status = ref('正在初始化'), error = ref('')
const categories = computed(() => [...new Set(templates.value.map(x => x.category))])
const visibleTemplates = computed(() => templates.value.filter(x => selectedCategory.value === 'all' || x.category === selectedCategory.value))
const selectedTemplate = computed(() => templates.value.find(x => x.id === selectedId.value))
const selectedInstance = computed(() => instances.value.find(x => x.id === selectedInstanceId.value))
const labels = {building:'建筑',vegetation:'植被',structure:'构筑物',facility:'设施',decoration:'装饰',sports:'运动设施',road:'道路',water:'水域',terrain:'地形'}
let renderer, scene, camera, controls, observer, frame, serial = 0
const objects = new Map()
const categoryLabel = value => labels[value] || value

function resize() {
  if (!renderer || !viewport.value) return
  const w = Math.max(1, viewport.value.clientWidth), h = Math.max(1, viewport.value.clientHeight)
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix()
}
function addTemplate() {
  try {
    const item = selectedTemplate.value
    if (!item) return
    const id = 'lab-instance-' + (++serial), n = instances.value.length
    const object = runtime.templates.createInto(scene, item.id, {
      instanceId: id,
      parameters: { dimensions: { width: 5, height: item.category === 'building' ? 7 : 3.5, depth: 4 }, visualStyle: 'anime-painted', style: 'anime-painted', width: 5, height: 7, depth: 4, label: item.name },
      transform: { position: [((n % 4) - 1.5) * 10, 0, Math.floor(n / 4) * 9 - 5], scale: [scale.value, scale.value, scale.value] },
    })
    objects.set(id, object)
    instances.value.push({ id, name: item.name, templateId: item.id, category: item.category })
    selectedInstanceId.value = id; status.value = '已添加 ' + item.name; error.value = ''
  } catch (e) { error.value = e?.message || '模板实例化失败' }
}
function removeInstance(id) {
  const object = objects.get(id)
  if (object) scene.remove(object)
  objects.delete(id); instances.value = instances.value.filter(x => x.id !== id)
  if (selectedInstanceId.value === id) selectedInstanceId.value = instances.value.at(-1)?.id || ''
}
function focusInstance(id) {
  selectedInstanceId.value = id
  const object = objects.get(id)
  if (object) { controls.target.copy(object.position); controls.update() }
}
function clearScene() { [...objects.keys()].forEach(removeInstance); status.value = '场景已清空' }
function resetCamera() { camera.position.set(30, 28, 34); controls.target.set(0, 0, 0); controls.update() }

let runtime
onMounted(() => {
  try {
    runtime = createCampusAssetTemplateRuntime(THREE)
    templates.value = runtime.templates.list()
    selectedId.value = templates.value.find(x => x.category === 'building')?.id || templates.value[0]?.id || ''
    scene = runtime.createSandboxScene()
    scene.background = new THREE.Color('#dfe8e0')
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 140), new THREE.MeshStandardMaterial({ color: '#9eae8d', roughness: 1 }))
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08; ground.receiveShadow = true; scene.add(ground)
    const grid = new THREE.GridHelper(180, 36, '#71836e', '#c2cdbb'); grid.position.y = -0.06; scene.add(grid)
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500); camera.position.set(30, 28, 34)
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace; viewport.value.replaceChildren(renderer.domElement)
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 0, 0); controls.update()
    observer = new ResizeObserver(resize); observer.observe(viewport.value); resize()
    const render = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render) }; render()
    status.value = '模板库已加载 ' + templates.value.length + ' 个模板定义'
  } catch (e) { error.value = e?.message || '初始化失败'; status.value = '初始化失败' }
})
watch(scale, value => { const object = objects.get(selectedInstanceId.value); if (object) object.scale.setScalar(value) })
onBeforeUnmount(() => {
  cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose()
  scene?.traverse(o => { if (o.geometry) o.geometry.dispose() })
  renderer?.dispose()
})
</script>

<template>
  <main class="lab">
    <header><div><small>NCGXY CAMPUS / ASSET RUNTIME POC</small><h1>Three.js 素材模板验收台</h1><p>验证独立模板加载、实例化和组合。此页面为隔离环境，不修改正式沙盒。</p></div><a href="/">返回校园</a></header>
    <section class="layout">
      <aside class="panel">
        <h3>素材模板库 <span>{{ visibleTemplates.length }} 项</span></h3>
        <label>类别筛选</label><select v-model="selectedCategory"><option value="all">全部类别</option><option v-for="c in categories" :key="c" :value="c">{{ categoryLabel(c) }}</option></select>
        <div class="templates"><button v-for="item in visibleTemplates" :key="item.id" :class="{active:selectedId===item.id}" @click="selectedId=item.id"><b>{{ item.name }}</b><small>{{ categoryLabel(item.category) }} · v{{ item.version }}</small></button></div>
      </aside>
      <section class="viewport-panel"><div ref="viewport" class="viewport"></div><div class="toolbar"><button @click="resetCamera">复位视角</button><button @click="clearScene">清空场景</button><span>左键旋转 · 滚轮缩放 · 右键平移</span></div><div v-if="error" class="error">{{ error }}</div><div class="hint">{{ status }}</div></section>
      <aside class="panel inspector">
        <h3>模板实例化 <span>POC</span></h3>
        <div v-if="selectedTemplate" class="selected"><small>{{ categoryLabel(selectedTemplate.category) }} / {{ selectedTemplate.id }}</small><b>{{ selectedTemplate.name }}</b><small>模板版本 {{ selectedTemplate.version }}</small></div>
        <label>初始缩放 {{ scale.toFixed(1) }}×</label><input v-model.number="scale" type="range" min="0.5" max="2" step="0.1">
        <button class="add" @click="addTemplate">＋ 添加到场景</button>
        <hr><h3>场景实例 <span>{{ instances.length }} 个</span></h3>
        <div class="instances"><div v-for="item in instances" :key="item.id" :class="{active:selectedInstanceId===item.id}"><button class="instance" @click="focusInstance(item.id)"><b>{{ item.name }}</b><small>{{ item.id }}</small></button><button class="remove" @click="removeInstance(item.id)">×</button></div><p v-if="!instances.length">尚未添加实例。选择模板后点击添加。</p></div>
        <label v-if="selectedInstance">选中实例缩放</label><input v-if="selectedInstance" v-model.number="scale" type="range" min="0.5" max="2" step="0.1">
      </aside>
    </section>
    <footer>仅验证模板加载与组合，不连接正式校园数据，不写入地图文档或编辑器状态。</footer>
  </main>
</template>

<style scoped>
.lab{min-height:100vh;background:#edf1ed;color:#243329;padding:24px;box-sizing:border-box;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}header{max-width:1600px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:center;gap:20px}header small{font-size:10px;letter-spacing:.15em;color:#66816b;font-weight:800}h1{font-size:25px;margin:7px 0}header p{font-size:13px;color:#718075;margin:0}header a{color:#386b4b;text-decoration:none;font-weight:700;font-size:13px}.layout{max-width:1600px;margin:auto;display:grid;grid-template-columns:250px minmax(400px,1fr) 270px;gap:13px;min-height:calc(100vh - 160px)}.panel,.viewport-panel{background:white;border:1px solid #dce4dc;border-radius:11px;overflow:hidden;min-width:0}.panel{padding:15px;display:flex;flex-direction:column}.panel h3{font-size:13px;margin:0 0 14px;display:flex;justify-content:space-between}.panel h3 span{font-size:11px;color:#87948a;font-weight:400}.panel label{font-size:11px;color:#768378;margin:12px 0 7px}.panel select{padding:9px;border:1px solid #dce4dc;border-radius:7px}.templates,.instances{overflow:auto;display:flex;flex-direction:column;gap:5px;margin-top:9px}.templates button{display:flex;flex-direction:column;gap:4px;text-align:left;border:1px solid transparent;background:transparent;border-radius:7px;padding:9px;cursor:pointer;color:#34453a}.templates button.active,.instances>div.active{background:#eef6ef;border-color:#bcd2bf}.templates b,.instance b{font-size:12px}.templates small,.instance small,.selected small{font-size:10px;color:#89968b}.viewport-panel{position:relative;min-height:580px;background:#dfe8e0}.viewport{position:absolute;inset:0}.viewport :deep(canvas){display:block;width:100%;height:100%}.toolbar{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:7px;align-items:center;pointer-events:none}.toolbar button{pointer-events:auto;border:1px solid #d6e0d6;background:#ffffffed;border-radius:7px;padding:7px 10px;font-size:11px;cursor:pointer}.toolbar span{margin-left:auto;background:#ffffffc9;padding:7px;border-radius:6px;font-size:10px;color:#718075}.hint{position:absolute;bottom:12px;left:12px;background:#ffffffd9;border-radius:6px;padding:7px 10px;font-size:10px;color:#647468}.selected{display:flex;flex-direction:column;gap:7px;padding:12px;background:#f4f7f3;border-radius:8px}.selected b{font-size:15px}.panel input{width:100%;accent-color:#4f855e}.add{margin-top:14px;border:0;border-radius:8px;background:#3d7950;color:white;padding:11px;font-weight:700;cursor:pointer}.panel hr{border:0;border-top:1px solid #e8ede8;margin:18px 0}.instances>div{display:flex;align-items:center;border:1px solid #e5ebe5;border-radius:7px}.instance{flex:1;display:flex;flex-direction:column;gap:4px;text-align:left;background:transparent;border:0;padding:9px;cursor:pointer;color:#34453a}.remove{border:0;background:transparent;color:#9a665d;font-size:19px;padding:5px 10px;cursor:pointer}.instances p{font-size:11px;color:#9aa49b;text-align:center;padding:15px}.error{position:absolute;bottom:48px;left:12px;background:#fff0ee;color:#a4493f;padding:9px;border-radius:7px;font-size:11px}footer{max-width:1600px;margin:12px auto;text-align:right;color:#87948a;font-size:10px}@media(max-width:1000px){.layout{grid-template-columns:210px minmax(280px,1fr)}.inspector{grid-column:1/-1;min-height:240px}}@media(max-width:650px){.lab{padding:12px}header{align-items:flex-start;flex-direction:column}.layout{display:flex;flex-direction:column}.templates{max-height:220px}.viewport-panel{min-height:450px}footer{text-align:left}}
</style>
