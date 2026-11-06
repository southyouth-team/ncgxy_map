<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { createCampusEngine } from '../three/engine/createCampusEngine.js'
import { createObjectSculptModel } from '../three/reconstruction/createObjectSculptModel.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'
const viewport = ref(null)
const prompt = ref('生成一栋现代风格的两层大学教学楼。建筑有清晰的主入口、规则的矩形主体、两层连续立面、成组窗户、屋顶女儿墙和可识别的楼层分界。整体比例真实，适合从外部进入室内。')
const generating = ref(false)
const ready = ref(false)
const generated = ref(false)
const status = ref('正在初始化世界场景')
const error = ref('')
const indoor = ref(false)
const indoorFloor = ref(1)
const indoorFloors = ref([1])
const indoorPrompt = ref('')
const buildingInfo = ref(null)
const environment = ref({ timeOfDay: 'day', weather: 'clear', wind: 0.25 })
let engine = null

async function requestJson(path, body) {
  const response = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || 'AI 请求失败：HTTP ' + response.status)
  return payload
}

async function generateBuilding() {
  if (generating.value || !ready.value) return
  if (!prompt.value.trim()) { error.value = '请先填写教学楼生成要求'; return }
  generating.value = true
  error.value = ''
  status.value = '正在调用 AI 生成教学楼结构…'
  try {
    const result = await requestJson('/assets/ai-image/generate-object', {
      objectType: '两层大学教学楼',
      visualStyle: 'realistic',
      prompt: prompt.value.trim(),
    })
    const spec = result?.objectSculptSpec
    if (!spec) throw new Error('AI 返回结果缺少 ObjectModelSpec 3.0')
    status.value = 'AI 结构已返回，正在构建 Three.js 几何…'
    const model = createObjectSculptModel(THREE, spec, { source: 'world-sandbox-mvp' })
    buildingInfo.value = engine.mountMvpBuilding(model, { floors: 2, floorHeight: 4.2 })
    generated.value = true
    status.value = 'AI 建筑已装入共享世界。使用 WASD 移动，靠近入口后按 E 进入。'
  } catch (cause) {
    error.value = cause?.message || '教学楼生成失败'
    status.value = '生成未完成'
  } finally {
    generating.value = false
  }
}

function handleIndoorState(state = {}) {
  indoor.value = Boolean(state.active)
  indoorFloor.value = Number(state.floor) || 1
  indoorFloors.value = Array.isArray(state.floors) ? state.floors : [1]
  if (state.active) status.value = '室内空间 · ' + (state.buildingName || 'AI 教学楼') + ' · ' + indoorFloor.value + ' 楼'
  else if (generated.value) status.value = '已返回室外世界。使用 WASD 移动，靠近入口后按 E 进入。'
}

function handleIndoorPrompt(payload = {}) {
  indoorPrompt.value = payload.visible ? payload.text || '' : ''
}

function navigateFloor(level) {
  if (!indoor.value || !engine) return
  const accepted = engine.navigateToIndoorFloor(level)
  if (!accepted) status.value = '当前楼层无法规划到目标楼层的路线，请检查楼梯连接'
  else status.value = '正在规划到 ' + level + ' 楼的楼梯路线…'
}

function exitBuilding() {
  engine?.exitIndoorPrototype()
}

function applyEnvironment() {
  if (!engine || indoor.value) return
  engine.setEnvironment(environment.value)
}

onMounted(async () => {
  if (!viewport.value) return
  engine = createCampusEngine(viewport.value, {
    onReady: () => {
      ready.value = true
      status.value = '世界场景已就绪。先生成一栋 AI 教学楼。'
    },
    onIndoorStateChange: handleIndoorState,
    onIndoorPromptChange: handleIndoorPrompt,
    onError: cause => { error.value = cause?.message || '场景初始化失败' },
  }, { sceneType: 'rpg-sample', isometricRpg: true, viewMode: '3d' })
  try {
    await engine.init()
    engine.setMode('thirdPerson')
    engine.setEnvironment(environment.value)
  } catch (cause) {
    error.value = cause?.message || '世界场景初始化失败'
  }
})

onBeforeUnmount(() => {
  engine?.dispose()
  engine = null
})
</script>

<template>
  <main class="world-mvp">
    <div ref="viewport" class="world-mvp__viewport"></div>
    <header class="world-mvp__header">
      <div>
        <div class="world-mvp__eyebrow">AI 3D WORLD BUILDER · MVP</div>
        <h1>三维世界最小验证</h1>
        <p>{{ status }}</p>
      </div>
      <a href="/asset-template-lab">返回资产工坊</a>
    </header>

    <aside class="world-mvp__panel">
      <section>
        <h2>01 · AI 生成资产</h2>
        <label for="world-mvp-prompt">教学楼生成要求</label>
        <textarea id="world-mvp-prompt" v-model="prompt" rows="6" :disabled="generating || !ready"></textarea>
        <button class="world-mvp__primary" :disabled="generating || !ready" @click="generateBuilding">
          {{ generating ? '生成中…' : generated ? '重新生成并替换建筑' : '生成并装入世界' }}
        </button>
        <small v-if="buildingInfo">已装载：{{ buildingInfo.floors }} 层 · {{ buildingInfo.dimensions.width }} × {{ buildingInfo.dimensions.depth }} × {{ buildingInfo.dimensions.height }}</small>
        <p v-if="error" class="world-mvp__error">{{ error }}</p>
      </section>

      <section>
        <h2>02 · 世界移动与空间交互</h2>
        <p>点击三维画布后使用 WASD 移动，鼠标拖动调整视角。靠近教学楼入口后按 E 进入或离开。</p>
        <div class="world-mvp__keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>移动</span><kbd>E</kbd><span>交互</span></div>
        <p v-if="indoorPrompt" class="world-mvp__prompt">{{ indoorPrompt }}</p>
        <div v-if="indoor" class="world-mvp__floor-actions">
          <button v-for="level in indoorFloors" :key="level" :class="{ active: indoorFloor === level }" @click="navigateFloor(level)">前往 {{ level }} 楼</button>
          <button @click="exitBuilding">返回室外</button>
        </div>
      </section>

      <section>
        <h2>03 · 环境控制</h2>
        <div class="world-mvp__environment-row">
          <label for="world-mvp-time">时间</label>
          <select id="world-mvp-time" v-model="environment.timeOfDay" :disabled="!ready || indoor" @change="applyEnvironment">
            <option value="day">白天</option><option value="night">夜晚</option>
          </select>
        </div>
        <div class="world-mvp__environment-row">
          <label for="world-mvp-weather">天气</label>
          <select id="world-mvp-weather" v-model="environment.weather" :disabled="!ready || indoor" @change="applyEnvironment">
            <option value="clear">晴天</option><option value="rain">下雨</option>
          </select>
        </div>
        <div class="world-mvp__environment-row">
          <label for="world-mvp-wind">风力 {{ Math.round(environment.wind * 100) }}%</label>
          <input id="world-mvp-wind" v-model.number="environment.wind" type="range" min="0" max="1" step="0.05" :disabled="!ready || indoor" @input="applyEnvironment">
        </div>
        <small>雨滴、天空雾效、光照和样板树冠会随环境参数变化。当前为轻量实时效果，不是流体或气象物理模拟。</small>
      </section>

      <section>
        <h2>04 · 当前验证状态</h2>
        <ul>
          <li :class="{ done: ready }">Three.js 世界运行时</li>
          <li :class="{ done: generated }">AI 生成模型装入共享场景</li>
          <li :class="{ done: indoor }">进入建筑室内空间</li>
          <li :class="{ done: indoor && indoorFloor === 2 }">跨楼层导航至二楼</li>
        </ul>
        <small>说明：当前室内楼层和房间由现有空间原型生成，AI 生成的是建筑外观模型。MVP 第一轮先验证资产与世界运行时的接入，不把外观几何误当成已自动推导的室内 BIM。</small>
      </section>
    </aside>
  </main>
</template>

<style scoped>
.world-mvp { position:relative; width:100%; height:100vh; min-height:620px; overflow:hidden; background:#dce5df; color:#24332b; font-family:inherit; }
.world-mvp__viewport { position:absolute; inset:0; }
.world-mvp__viewport :deep(canvas) { display:block; width:100%; height:100%; }
.world-mvp__header { position:absolute; z-index:2; top:18px; left:20px; right:20px; display:flex; justify-content:space-between; align-items:flex-start; gap:16px; pointer-events:none; }
.world-mvp__header > div, .world-mvp__header > a { pointer-events:auto; }
.world-mvp__header > div { padding:14px 18px; border:1px solid rgba(255,255,255,.75); border-radius:12px; background:rgba(250,252,250,.9); box-shadow:0 8px 28px rgba(28,45,35,.12); backdrop-filter:blur(12px); }
.world-mvp__eyebrow { color:#54745e; font-size:10px; letter-spacing:1.4px; font-weight:800; }
.world-mvp__header h1 { margin:5px 0 4px; font-size:21px; }
.world-mvp__header p { margin:0; color:#64736a; font-size:12px; }
.world-mvp__header > a { padding:11px 14px; border-radius:9px; background:rgba(250,252,250,.92); color:#315b40; text-decoration:none; font-size:13px; }
.world-mvp__panel { position:absolute; z-index:2; top:116px; left:20px; bottom:18px; width:min(360px,calc(100vw - 40px)); overflow:auto; padding:16px; border:1px solid rgba(255,255,255,.8); border-radius:12px; background:rgba(250,252,250,.94); box-shadow:0 12px 36px rgba(28,45,35,.14); backdrop-filter:blur(12px); }
.world-mvp__panel section + section { margin-top:17px; padding-top:16px; border-top:1px solid #e2e9e3; }
.world-mvp__panel h2 { margin:0 0 10px; font-size:14px; }
.world-mvp__panel label { display:block; margin-bottom:6px; color:#68776e; font-size:12px; }
.world-mvp__panel textarea { box-sizing:border-box; width:100%; resize:vertical; border:1px solid #d5dfd7; border-radius:8px; padding:10px; color:#29382f; background:#fff; font-family:inherit; font-size:12px; line-height:1.6; }
.world-mvp__panel button { border:1px solid #d3ded5; border-radius:7px; padding:8px 10px; color:#355341; background:#fff; cursor:pointer; font:inherit; font-size:12px; }
.world-mvp__panel button:disabled { opacity:.55; cursor:not-allowed; }
.world-mvp__panel .world-mvp__primary { width:100%; margin-top:9px; border-color:#356c49; background:#356c49; color:#fff; font-weight:700; }
.world-mvp__panel small { display:block; margin-top:8px; color:#6b7a70; font-size:11px; line-height:1.5; }
.world-mvp__panel p { color:#5f6e64; font-size:12px; line-height:1.6; }
.world-mvp__error { color:#b42318 !important; }
.world-mvp__keys { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
.world-mvp__keys kbd { min-width:22px; padding:4px 6px; border:1px solid #cbd6cd; border-radius:5px; background:#fff; text-align:center; font-size:11px; }
.world-mvp__keys span { margin:0 8px 0 2px; color:#77847b; font-size:11px; }
.world-mvp__prompt { padding:8px 10px; border-radius:7px; background:#eaf3eb; color:#315b40 !important; }
.world-mvp__floor-actions { display:flex; gap:6px; flex-wrap:wrap; }
.world-mvp__floor-actions button.active { border-color:#356c49; background:#eaf3eb; }
.world-mvp__panel ul { margin:0; padding-left:18px; color:#7a877e; font-size:12px; line-height:1.9; }
.world-mvp__environment-row { display:grid; grid-template-columns:78px 1fr; align-items:center; gap:8px; margin:8px 0; }
.world-mvp__environment-row label { margin:0; }
.world-mvp__environment-row select { width:100%; padding:7px 8px; border:1px solid #d3ded5; border-radius:7px; background:#fff; color:#355341; font:inherit; font-size:12px; }
.world-mvp__environment-row input[type="range"] { width:100%; accent-color:#356c49; }

.world-mvp__panel li.done { color:#287342; font-weight:700; }
@media (max-width:720px) {
  .world-mvp__header { top:10px; left:10px; right:10px; }
  .world-mvp__header > div { max-width:calc(100vw - 145px); padding:10px 12px; }
  .world-mvp__header h1 { font-size:17px; }
  .world-mvp__header p { max-width:55vw; }
  .world-mvp__panel { top:auto; left:10px; right:10px; bottom:10px; width:auto; max-height:48vh; padding:12px; }
}
</style>
