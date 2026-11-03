<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { createCampusEngine } from './three/engine/createCampusEngine.js'
import CampusPixelMap from './components/CampusPixelMap.vue'
import CampusPlanEditor from './editor/CampusPlanEditor.vue'
import { loadCampusSceneData } from './three/scene/loadCampusSceneData.js'
import { createSceneDocument } from './three/scene/sceneDocument.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'

const viewport = ref(null)
const appShell = ref(null)
const isMobile = ref(false)
const isPortrait = ref(false)
const activeMode = ref('overview')
const loading = ref(true)
const errorMessage = ref('')
const engineReady = ref(false)
const indoorPrototypeActive = ref(false)
const indoorFloor = ref(1)
const indoorFloors = ref([1])
const indoorBuildingName = ref('室内空间样板')
const nearIndoorStairs = ref(false)
const nearIndoorRoom = ref(null)
const activeIndoorRoom = ref(null)
const initialView = new URLSearchParams(window.location.search).get('view')
const isRpgSample = initialView === 'showcase'
const showEditor = ref(initialView === 'editor' || initialView === 'showcase')
const editorViewMode = ref(initialView === 'showcase' ? '3d' : '2d')
const selectedObject = ref(null)
const sceneDocument = ref(null)
const sceneRevision = ref(0)
const sceneSource = ref(null)
const sceneSaving = ref(false)
const sceneSaveMessage = ref('')
const selectedSceneObject = computed(() => sceneDocument.value?.objects?.find((item) => item.id === selectedObject.value?.sceneObjectId) || null)

let engine

const modes = isRpgSample
  ? [
      { id: 'overview', label: '场景总览', hint: '校园布局' },
      { id: 'thirdPerson', label: 'RPG 探索', hint: '等距跟随' },
      { id: 'firstPerson', label: '沉浸视角', hint: '第一人称' },
    ]
  : [
      { id: 'overview', label: '上帝视角', hint: '像素地图' },
      { id: 'thirdPerson', label: '第三人称', hint: '跟随漫游' },
      { id: 'firstPerson', label: '沉浸视角', hint: '第一人称' },
    ]

function adjacentIndoorFloor(direction) {
  const levels = [...indoorFloors.value].sort((a, b) => a - b)
  const index = levels.indexOf(indoorFloor.value)
  return levels[index + direction]
}

function switchIndoorFloor(direction) {
  const target = adjacentIndoorFloor(direction)
  if (target !== undefined) engine?.switchIndoorFloor(target)
}

async function switchMode(mode) {
  activeMode.value = mode
  engine?.setMode(mode)
  if (isMobile.value && mode !== 'overview') {
    try {
      if (!document.fullscreenElement && appShell.value?.requestFullscreen) await appShell.value.requestFullscreen()
    } catch { /* 全屏被拒绝时继续普通网页模式 */ }
    try { await screen.orientation?.lock?.('landscape') } catch { /* 部分移动浏览器不支持网页锁定方向 */ }
  } else if (mode === 'overview') {
    try { screen.orientation?.unlock?.() } catch { /* 忽略不支持的环境 */ }
    if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* 忽略 */ } }
  }
}

async function loadSceneData() {
  const headers = { 'X-Dev-User-Id': DEV_USER_ID }
  const get = async (path) => {
    const response = await fetch(`${API_BASE}${path}`, { headers })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || `地图服务请求失败：HTTP ${response.status}`)
    return payload
  }
  const campuses = await get('/campuses')
  const campus = campuses.find((item) => item.slug === 'ncgxy')
  if (!campus) throw new Error('地图服务中尚未初始化南昌工学院校园')
  const maps = await get(`/campuses/${campus.id}/maps`)
  const map = maps.find((item) => item.slug === 'main') || maps[0]
  if (!map) throw new Error('当前校园尚未创建地图')
  const loaded = await loadCampusSceneData({ campusId: campus.id, map, userId: DEV_USER_ID })
  sceneRevision.value = loaded.revision
  sceneSource.value = loaded.source
  sceneDocument.value = loaded.document || createSceneDocument({ campusId: String(campus.id), mapId: String(map.id), name: `${campus.name} · ${map.name}` })
  sceneDocument.value.campusId = String(campus.id)
  sceneDocument.value.mapId = String(map.id)
  if (!loaded.document) sceneDocument.value.objects = loaded.objects.map((item) => item.sceneObject)
  return loaded
}

async function saveSceneProperties() {
  if (!sceneDocument.value || sceneSource.value !== 'postgis' || !selectedSceneObject.value) return
  sceneSaving.value = true
  sceneSaveMessage.value = ''
  try {
    const response = await fetch(`${API_BASE}/campuses/${sceneDocument.value.campusId}/maps/${sceneDocument.value.mapId}/scene`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({ revision: sceneRevision.value, document: sceneDocument.value }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (response.status === 409) throw new Error('场景版本冲突：其他编辑已先行保存，请重新加载场景后再修改')
      throw new Error(payload.message || `保存失败：HTTP ${response.status}`)
    }
    sceneRevision.value = Number(payload.revision ?? payload.document?.revision ?? sceneRevision.value + 1)
    sceneDocument.value = payload.document || { ...sceneDocument.value, revision: sceneRevision.value }
    engine?.updateSceneObject(selectedSceneObject.value)
    sceneSaveMessage.value = '三维属性已保存'
  } catch (error) {
    sceneSaveMessage.value = error.message || '保存失败'
  } finally {
    sceneSaving.value = false
  }
}

function setMoveKey(key, pressed) { engine?.setVirtualKey(key, pressed) }
function updateViewportState() {
  isMobile.value = window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 760
  isPortrait.value = window.innerHeight > window.innerWidth
}

function onExplorerHotkey(event) {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))) return
  if (event.key.toLowerCase() !== 'v' || activeMode.value === 'overview') return
  event.preventDefault()
  switchMode(activeMode.value === 'firstPerson' ? 'thirdPerson' : 'firstPerson')
}

function focusCampus() {
  engine?.focusCampus()
}

function openEditor() {
  showEditor.value = true
  editorViewMode.value = '2d'
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'editor')
  window.history.replaceState({}, '', url)
}

function switchEditorView(mode, document) {
  editorViewMode.value = mode
  if (mode === '3d') { activeMode.value = 'overview'; engine?.previewCampusPlan(document) }
  else engine?.clearRpgPreview()
}

function closeEditor() {
  engine?.clearRpgPreview()
  showEditor.value = false
  editorViewMode.value = '2d'
  const url = new URL(window.location.href)
  url.searchParams.delete('view')
  window.history.replaceState({}, '', url)
  activeMode.value = 'overview'
  engine?.setMode('overview')
}

function toggleHelp() {
  const panel = document.querySelector('.help-panel')
  panel?.classList.toggle('is-visible')
}

onMounted(async () => {
  updateViewportState()
  window.addEventListener('resize', updateViewportState)
  window.addEventListener('orientationchange', updateViewportState)
  window.addEventListener('keydown', onExplorerHotkey)
  // 当前默认入口使用轻量 Canvas 2D 像素地图；Three.js 不再随首页启动。
  // 保留原三维引擎代码，后续作为独立预览能力按需启用。
  if (!showEditor.value) {
    loading.value = false
    engineReady.value = false
    return
  }
  try {
    engine = createCampusEngine(viewport.value, {
      onObjectSelected: (object) => { selectedObject.value = object },
      onIndoorStateChange: (state) => {
        indoorPrototypeActive.value = Boolean(state.active)
        if (state.active) { indoorFloor.value = state.floor; indoorFloors.value = state.floors || [state.floor]; indoorBuildingName.value = state.buildingName || '室内空间样板'; nearIndoorStairs.value = Boolean(state.nearStairs); nearIndoorRoom.value = state.nearRoom || null; activeIndoorRoom.value = state.activeRoom || null }
        else { indoorFloor.value = 1; indoorFloors.value = [1]; nearIndoorStairs.value = false; nearIndoorRoom.value = null; activeIndoorRoom.value = null }
      },
      onReady: () => {
        loading.value = false
        engineReady.value = true
      },
      onError: (error) => {
        errorMessage.value = error?.message || '三维场景初始化失败'
        loading.value = false
      },
    }, { sceneType: isRpgSample ? 'rpg-sample' : 'campus' })
    await engine.init()
  } catch (error) {
    errorMessage.value = error?.message || '三维场景初始化失败'
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportState)
  window.removeEventListener('orientationchange', updateViewportState)
  window.removeEventListener('keydown', onExplorerHotkey)
  engine?.dispose()
})
</script>

<template>
  <main ref="appShell" :class="['app-shell', { 'is-overview': activeMode === 'overview', 'is-mobile': isMobile, 'is-rpg-sample': isRpgSample } ]">
    <CampusPixelMap v-if="!showEditor" />
    <div ref="viewport" class="scene-viewport" v-show="showEditor && editorViewMode === '3d'"></div>
    <CampusPlanEditor v-if="showEditor" v-show="editorViewMode === '2d'" :campus-id="sceneDocument?.campusId" :map-id="sceneDocument?.mapId" :api-base="API_BASE" :dev-user-id="DEV_USER_ID" @preview="switchEditorView('3d', $event)" @close="closeEditor" />

    <template v-if="showEditor && editorViewMode === '3d'">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark">NC</div>
        <div>
          <div class="brand-title">南昌工学院</div>
          <div class="brand-subtitle">NANCHANG INSTITUTE OF TECHNOLOGY · 3D CAMPUS</div>
        </div>
      </div>
      <div class="showcase-actions">
        <span class="topbar-status"><span class="status-dot"></span> 宝可梦风格 · 2.5D 校园样板</span>
        <button class="showcase-back" @click="closeEditor">返回 2D 地图</button>
      </div>
    </header>

    <section class="intro-card">
      <div class="eyebrow">CAMPUS EXPLORER / 01</div>
      <h1>探索校园<br /><span>从这里开始</span></h1>
      <p>经典 RPG 斜俯视像素校园 · 教学楼、石板路、树木与角色探索样板。</p>
      <div class="intro-rule"><span></span></div>
      <div class="intro-foot">INTERACTIVE CAMPUS MAP</div>
    </section>

    <nav class="mode-switcher" aria-label="视角切换">
      <button
        v-for="mode in modes"
        :key="mode.id"
        :class="['mode-button', { active: activeMode === mode.id }]"
        @click="switchMode(mode.id)"
      >
        <span class="mode-label">{{ mode.label }}</span>
        <span class="mode-hint">{{ mode.hint }}</span>
      </button>
    </nav>

    <div v-if="isMobile && activeMode !== 'overview'" class="mobile-controls" aria-label="触屏移动控制">
      <div class="virtual-pad">
        <button class="virtual-key key-up" aria-label="向前移动" @pointerdown.prevent="setMoveKey('w', true)" @pointerup="setMoveKey('w', false)" @pointercancel="setMoveKey('w', false)" @pointerleave="setMoveKey('w', false)">▲</button>
        <button class="virtual-key key-left" aria-label="向左移动" @pointerdown.prevent="setMoveKey('a', true)" @pointerup="setMoveKey('a', false)" @pointercancel="setMoveKey('a', false)" @pointerleave="setMoveKey('a', false)">◀</button>
        <button class="virtual-key key-down" aria-label="向后移动" @pointerdown.prevent="setMoveKey('s', true)" @pointerup="setMoveKey('s', false)" @pointercancel="setMoveKey('s', false)" @pointerleave="setMoveKey('s', false)">▼</button>
        <button class="virtual-key key-right" aria-label="向右移动" @pointerdown.prevent="setMoveKey('d', true)" @pointerup="setMoveKey('d', false)" @pointercancel="setMoveKey('d', false)" @pointerleave="setMoveKey('d', false)">▶</button>
      </div>
      <button class="virtual-key sprint-key" aria-label="加速移动" @pointerdown.prevent="setMoveKey('shift', true)" @pointerup="setMoveKey('shift', false)" @pointercancel="setMoveKey('shift', false)" @pointerleave="setMoveKey('shift', false)">加速</button>
      <div class="look-hint">滑动右侧区域转动视角</div>
    </div>

    <div v-if="isMobile && activeMode !== 'overview' && isPortrait" class="rotate-device-hint">
      <div class="rotate-icon">↻</div>
      <strong>请将手机横向放置</strong>
      <span>横屏可获得完整校园视野与操作空间</span>
    </div>

    <aside class="control-card">
      <div class="control-heading">
        <span>操作指南</span>
        <button class="help-toggle" aria-label="显示操作指南" @click="toggleHelp">?</button>
      </div>
      <div class="help-panel is-visible">
        <template v-if="activeMode === 'overview'">
          <div class="control-row"><kbd>拖动</kbd><span>平移视野</span></div>
          <div class="control-row"><kbd>滚轮</kbd><span>缩放校园</span></div>
          <div class="control-row"><kbd>双击</kbd><span>聚焦场景</span></div>
        </template>
        <template v-else-if="activeMode === 'thirdPerson'">
          <div class="control-row"><kbd>W A S D</kbd><span>控制角色移动</span></div>
          <div class="control-row"><kbd>拖动</kbd><span>调整等距镜头方向</span></div>
          <div class="control-row"><kbd>V</kbd><span>切换第一/第三人称</span></div>
          <div class="control-row"><kbd>滚轮</kbd><span>调整跟随距离</span></div>
        </template>
        <template v-else>
          <div class="control-row"><kbd>W A S D</kbd><span>前后左右移动</span></div>
          <div class="control-row"><kbd>鼠标</kbd><span>控制视线方向</span></div>
          <div class="control-row"><kbd>Shift</kbd><span>加速移动</span></div>
          <div class="control-row"><kbd>V</kbd><span>切换第一/第三人称</span></div>
          <div class="control-row"><kbd>Esc</kbd><span>退出鼠标控制</span></div>
        </template>
      </div>
      <div class="control-foot">方向以当前镜头朝向为基准</div>
    </aside>

    <div class="bottom-bar">
      <div class="coordinates"><span class="coordinate-dot"></span> CAMPUS / NANCHANG · CHINA</div>
      <button class="reset-button" @click="focusCampus"><span>↗</span> 重置视角</button>
    </div>

    <div v-if="loading" class="loading-screen">
      <div class="loader"></div>
      <div>正在加载 2.5D 校园样板</div>
      <span>INITIALIZING SCENE</span>
    </div>
    <aside v-if="selectedObject && !showEditor" style="position:absolute;right:24px;top:110px;z-index:12;min-width:190px;padding:14px 16px;background:rgba(255,255,255,.94);border:1px solid #d7ded7;border-radius:6px;color:#34443b;box-shadow:0 8px 24px rgba(30,50,40,.12)">
      <div style="font-size:10px;letter-spacing:1px;color:#7a887e">{{ selectedObject.interaction ? '已选中室内交互对象' : '已选中校园对象' }}</div>
      <strong style="display:block;margin-top:8px;font-size:13px">{{ selectedObject.name }}</strong>
      <div style="margin-top:7px;font-size:10px;color:#6d7b71">类型：{{ selectedObject.objectType || '未分类' }}</div>
      <template v-if="selectedObject.interaction">
        <div style="margin-top:7px;font-size:10px;color:#6d7b71">所属房间：{{ selectedObject.interaction.roomName }}</div>
        <div style="margin-top:4px;font-size:10px;color:#6d7b71">对象 ID：{{ selectedObject.interaction.id }}</div>
        <div style="margin-top:4px;font-size:10px;color:#6d7b71">交互类型：{{ selectedObject.interaction.interactionType }} · {{ selectedObject.interaction.action }}</div>
        <div style="margin-top:4px;font-size:10px;color:#315f49">操作提示：{{ selectedObject.interaction.operationHint }}</div>
        <p style="margin:9px 0 0;font-size:11px;line-height:1.6;color:#526257">{{ selectedObject.interaction.description }}</p>
      </template>
      <div v-else style="margin-top:4px;font-size:10px;color:#6d7b71">对象 ID：{{ selectedObject.featureId || selectedObject.buildingId || selectedObject.name }}</div>
      <template v-if="selectedSceneObject?.type === 'building'">
        <label style="display:block;margin-top:12px;font-size:10px;color:#6d7b71">建筑楼层</label>
        <input v-model.number="selectedSceneObject.properties.floors" type="number" min="1" max="200" step="1" @change="engine?.updateSceneObject(selectedSceneObject)" style="width:100%;margin-top:5px;padding:6px;border:1px solid #d7ded7;border-radius:4px">
        <label style="display:block;margin-top:9px;font-size:10px;color:#6d7b71">层高（场景单位）</label>
        <input v-model.number="selectedSceneObject.properties.floorHeight" type="number" min="0.1" max="30" step="0.1" @change="engine?.updateSceneObject(selectedSceneObject)" style="width:100%;margin-top:5px;padding:6px;border:1px solid #d7ded7;border-radius:4px">
        <button :disabled="sceneSaving || sceneSource !== 'postgis'" style="width:100%;margin-top:10px;padding:7px 9px;border:1px solid #315f49;background:#315f49;color:white;border-radius:4px;font-size:10px;cursor:pointer" @click="saveSceneProperties">{{ sceneSaving ? '保存中…' : '保存三维属性' }}</button>
        <div v-if="sceneSaveMessage" style="margin-top:7px;font-size:10px;color:#9a6037">{{ sceneSaveMessage }}</div>
      </template>
      <div v-else-if="!selectedObject.interaction" style="margin-top:9px;font-size:10px;color:#7a887e">该类型暂不支持三维属性编辑</div>
      <button style="margin-top:10px;padding:5px 9px;border:1px solid #d7ded7;background:#fff;border-radius:4px;font-size:10px;cursor:pointer" @click="engine?.clearSelection()">取消选择</button>
    </aside>
    <div v-if="errorMessage" class="error-toast">{{ errorMessage }}</div>
    <div v-if="activeMode === 'firstPerson' && engineReady" class="first-person-hint">
      点击场景进入沉浸漫游 · 按 Esc 释放鼠标
    </div>
    </template>
  </main>
</template>
