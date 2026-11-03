<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { createCampusEngine } from './three/engine/createCampusEngine.js'
import CampusPixelMap from './components/CampusPixelMap.vue'
import CampusPlanEditor from './editor/CampusPlanEditor.vue'
import IndoorFloorPlanEditor from './components/IndoorFloorPlanEditor.vue'
import BuildingFootprintEditor from './components/BuildingFootprintEditor.vue'
import { loadCampusSceneData } from './three/scene/loadCampusSceneData.js'
import { createSceneDocument } from './three/scene/sceneDocument.js'
import { CAMPUS_BUILDING_FOOTPRINTS, mapPixelToWorld } from './data/campus/campusLayout.js'
import { expandIndoorBuilding } from './three/indoor/indoorBuildingDefinitions.js'

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
const indoorPrompt = ref(null)
const initialUrlParams = new URLSearchParams(window.location.search)
const requestedBuildingId = initialUrlParams.get('buildingId')
const returnPixelX = Number(initialUrlParams.get('returnX'))
const returnPixelY = Number(initialUrlParams.get('returnY'))
const returnPixelPosition = initialUrlParams.has('returnX') && initialUrlParams.has('returnY')
  && Number.isFinite(returnPixelX) && Number.isFinite(returnPixelY)
  ? { x: returnPixelX, y: returnPixelY }
  : null
const returnWorldPosition = returnPixelPosition ? mapPixelToWorld(returnPixelPosition.x, returnPixelPosition.y) : null
const selectedBuildingId = ref(CAMPUS_BUILDING_FOOTPRINTS.some(item => item.id === requestedBuildingId) ? requestedBuildingId : (CAMPUS_BUILDING_FOOTPRINTS[0]?.id || ''))
const indoorFloorCount = ref(3)
const indoorEntryBusy = ref(false)
const indoorEditorOpen = ref(false)
const indoorDefinition = ref(null)
const indoorEditorMessage = ref('')
const indoorLayoutRevision = ref(0)
const indoorLayoutSaving = ref(false)
const indoorLayoutVersions = ref([])
const indoorHistoryOpen = ref(false)
const activeEditableFloor = computed(() => indoorDefinition.value?.floors?.find(floor => floor.level === indoorFloor.value) || null)
const indoorBuildingId = computed(() => indoorDefinition.value?.id || selectedBuildingId.value)
const initialView = new URLSearchParams(window.location.search).get('view')
const isRpgSample = false
const showEditor = ref(initialView === 'editor')
const editorViewMode = ref('2d')
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

function openSelectedBuildingInCampus() {
  if (!selectedBuildingId.value) return
  // RPG 样板场景与真实校园场景是两套 sceneType；进入室内前切换到校园底图场景。
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'showcase')
  url.searchParams.set('buildingId', selectedBuildingId.value)
  url.searchParams.delete('returnX')
  url.searchParams.delete('returnY')
  window.location.assign(url)
}

async function enterSelectedBuilding() {
  if (!selectedBuildingId.value || indoorEntryBusy.value || !engine) return
  indoorEntryBusy.value = true
  try {
    const buildingId = selectedBuildingId.value
    const building = CAMPUS_BUILDING_FOOTPRINTS.find(item => item.id === buildingId)
    const cacheKey = 'ncgxy-indoor-layout:' + buildingId + ':v1'
    const stored = localStorage.getItem(cacheKey)
    let saved = stored ? JSON.parse(stored) : null
    indoorLayoutRevision.value = 0
    if (sceneDocument.value?.campusId && sceneDocument.value?.mapId && sceneSource.value === 'postgis') {
      try {
        const response = await fetch(API_BASE + '/campuses/' + sceneDocument.value.campusId + '/maps/' + sceneDocument.value.mapId + '/scene/indoor-buildings/' + encodeURIComponent(buildingId), { headers: { 'X-Dev-User-Id': DEV_USER_ID } })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || '读取室内布局失败：HTTP ' + response.status)
        indoorLayoutRevision.value = Number(payload.revision || 0)
        if (payload.definition) saved = payload.definition
      } catch (error) {
        indoorEditorMessage.value = '服务端读取失败，已回退本地缓存：' + (error.message || '网络异常')
      }
    }
    const opened = engine.enterIndoorBuilding(buildingId, { name: building?.label || buildingId, floors: indoorFloorCount.value, floorsData: saved?.floors, floorHeight: saved?.floorHeight })
    if (opened) {
      indoorDefinition.value = engine.getIndoorBuildingDefinition()
      if (saved) indoorDefinition.value = { ...indoorDefinition.value, ...saved, id: buildingId }
      indoorDefinition.value.exterior ||= { roofStyle: 'flat' }
      engine.updateIndoorBuildingDefinition(indoorDefinition.value)
      indoorEditorOpen.value = false
      indoorEditorMessage.value = indoorLayoutRevision.value > 0 ? '已加载服务端布局 · 版本 ' + indoorLayoutRevision.value : saved ? '已加载本地缓存布局' : '已根据校园建筑占地生成初始模板'
    }
    if (!opened) errorMessage.value = '未能定位该建筑模型，请先加载校园真实底图场景'
  } catch (error) {
    errorMessage.value = error?.message || '室内空间生成失败'
  } finally {
    indoorEntryBusy.value = false
  }
}

function ensureIndoorDefinition() {
  if (indoorDefinition.value) return indoorDefinition.value
  indoorDefinition.value = engine?.getIndoorBuildingDefinition?.() || null
  return indoorDefinition.value
}

function expandCurrentBuilding(side) {
  if (!indoorDefinition.value) return
  try {
    indoorDefinition.value = expandIndoorBuilding(indoorDefinition.value, { side, amount: 2 })
    engine?.updateIndoorBuildingDefinition(indoorDefinition.value)
    indoorEditorMessage.value = '占地边界已向' + ({ north: '北', south: '南', east: '东', west: '西' }[side]) + '侧扩建 2 个场景单位；请检查布局后保存'
    indoorFloors.value = indoorDefinition.value.floors.map(floor => floor.level).sort((a,b) => a-b)
  } catch (error) {
    indoorEditorMessage.value = error?.message || '建筑扩建失败'
  }
}

function updateBuildingHeight() {
  const definition = indoorDefinition.value
  if (!definition) return
  definition.floorHeight = Math.max(2.8, Math.min(6, Number(definition.floorHeight) || 3.6))
  definition.floors.forEach(floor => { floor.wallHeight = definition.floorHeight - 0.45 })
  refreshIndoorLayout()
}

function refreshIndoorLayout() {
  try { engine?.updateIndoorBuildingDefinition(indoorDefinition.value); indoorFloors.value = indoorDefinition.value.floors.map(floor => floor.level).sort((a,b) => a-b); indoorEditorMessage.value = '建筑几何与室内布局已同步，记得保存' }
  catch (error) { indoorEditorMessage.value = error?.message || '布局校验失败' }
}

function addIndoorRoom() {
  const floor = activeEditableFloor.value; if (!floor) return
  const index = floor.rooms.length + 1
  floor.rooms.push({ id: indoorDefinition.value.id + '-' + floor.level + '-room-' + Date.now(), name: '新空间 ' + index, x: 0, z: -floor.depth / 2 + 4, width: Math.min(5, floor.width - 2), depth: Math.min(4, floor.depth / 2), doorWall: 'south', doorWidth: 1.2, furniture: [] })
  refreshIndoorLayout()
}

function removeIndoorRoom(roomId) { const floor = activeEditableFloor.value; if (!floor) return; floor.rooms = floor.rooms.filter(room => room.id !== roomId); refreshIndoorLayout() }

function addIndoorFloor() {
  const definition = indoorDefinition.value; if (!definition || definition.floors.length >= 30) return
  const level = Math.max(...definition.floors.map(floor => floor.level)) + 1; const source = definition.floors[0]
  const next = JSON.parse(JSON.stringify(source)); next.level = level; next.doors = []; next.rooms = next.rooms.map((room,index) => ({ ...room, id: definition.id + '-' + level + '-room-' + (index+1), name: room.name.replace(/\\d+/g, String(level)) }))
  definition.floors.push(next); indoorFloors.value = definition.floors.map(floor => floor.level).sort((a,b) => a-b); engine?.updateIndoorBuildingDefinition(definition); engine?.switchIndoorFloor(level)
}

function removeIndoorFloor() {
  const definition = indoorDefinition.value; if (!definition || definition.floors.length <= 1) return
  definition.floors = definition.floors.filter(floor => floor.level !== indoorFloor.value); indoorFloors.value = definition.floors.map(floor => floor.level).sort((a,b) => a-b)
  engine?.updateIndoorBuildingDefinition(definition); engine?.switchIndoorFloor(indoorFloors.value[0])
}

async function saveIndoorLayout() {
  if (!indoorDefinition.value || indoorLayoutSaving.value) return
  const definition = JSON.parse(JSON.stringify(indoorDefinition.value))
  const cacheKey = 'ncgxy-indoor-layout:' + definition.id + ':v1'
  indoorLayoutSaving.value = true
  try {
    if (sceneDocument.value?.campusId && sceneDocument.value?.mapId && sceneSource.value === 'postgis') {
      const response = await fetch(API_BASE + '/campuses/' + sceneDocument.value.campusId + '/maps/' + sceneDocument.value.mapId + '/scene/indoor-buildings/' + encodeURIComponent(definition.id), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID }, body: JSON.stringify({ revision: indoorLayoutRevision.value, definition }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 409) throw new Error('版本冲突：服务端当前版本为 ' + (payload.currentRevision ?? '未知') + '，请重新加载后再保存')
        throw new Error(payload.message || '保存失败：HTTP ' + response.status)
      }
      indoorLayoutRevision.value = Number(payload.revision || indoorLayoutRevision.value + 1)
      localStorage.setItem(cacheKey, JSON.stringify(payload.definition || definition))
      indoorEditorMessage.value = '已保存到服务器 · 版本 ' + indoorLayoutRevision.value
    } else {
      localStorage.setItem(cacheKey, JSON.stringify(definition))
      indoorEditorMessage.value = '当前未连接正式地图服务，已保存到本地浏览器'
    }
  } catch (error) {
    indoorEditorMessage.value = error?.message || '保存失败'
  } finally {
    indoorLayoutSaving.value = false
  }
}

async function loadIndoorLayoutVersions() {
  if (!sceneDocument.value?.campusId || !sceneDocument.value?.mapId || sceneSource.value !== 'postgis' || !indoorDefinition.value) {
    indoorEditorMessage.value = '历史版本需要连接正式地图服务'
    return
  }
  try {
    const path = API_BASE + '/campuses/' + sceneDocument.value.campusId + '/maps/' + sceneDocument.value.mapId + '/scene/indoor-buildings/' + encodeURIComponent(indoorDefinition.value.id) + '/versions'
    const response = await fetch(path, { headers: { 'X-Dev-User-Id': DEV_USER_ID } })
    const payload = await response.json().catch(() => [])
    if (!response.ok) throw new Error(payload.message || '读取历史版本失败')
    indoorLayoutVersions.value = Array.isArray(payload) ? payload : []
    indoorHistoryOpen.value = true
  } catch (error) {
    indoorEditorMessage.value = error?.message || '读取历史版本失败'
  }
}

async function restoreIndoorLayoutVersion(revision) {
  if (!indoorDefinition.value || indoorLayoutSaving.value) return
  try {
    const path = API_BASE + '/campuses/' + sceneDocument.value.campusId + '/maps/' + sceneDocument.value.mapId + '/scene/indoor-buildings/' + encodeURIComponent(indoorDefinition.value.id) + '/versions/' + revision
    const response = await fetch(path, { headers: { 'X-Dev-User-Id': DEV_USER_ID } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.definition) throw new Error(payload.message || '历史版本读取失败')
    indoorDefinition.value = payload.definition
    engine?.updateIndoorBuildingDefinition(indoorDefinition.value)
    indoorFloors.value = indoorDefinition.value.floors.map(floor => floor.level).sort((a,b) => a-b)
    indoorEditorMessage.value = '已载入历史版本，正在以新版本号保存…'
    await saveIndoorLayout()
    await loadIndoorLayoutVersions()
  } catch (error) {
    indoorEditorMessage.value = error?.message || '历史版本恢复失败'
  }
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

function openBuildingFromPixelMap(payload) {
  const buildingId = payload?.buildingId
  if (!CAMPUS_BUILDING_FOOTPRINTS.some(item => item.id === buildingId)) return
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'showcase')
  url.searchParams.set('buildingId', buildingId)
  if (Number.isFinite(payload?.playerPosition?.x) && Number.isFinite(payload?.playerPosition?.y)) {
    url.searchParams.set('returnX', String(payload.playerPosition.x))
    url.searchParams.set('returnY', String(payload.playerPosition.y))
  }
  window.location.assign(url)
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
  // 从室内样板返回像素地图前，先释放室内场景并恢复室外角色快照。
  engine?.exitIndoorPrototype()
  engine?.clearRpgPreview()
  showEditor.value = false
  editorViewMode.value = '2d'
  const url = new URL(window.location.href)
  url.searchParams.delete('view')
  url.searchParams.delete('buildingId')
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
      onIndoorPromptChange: (state) => { indoorPrompt.value = state?.visible ? state : null },
      onIndoorStateChange: (state) => {
        indoorPrototypeActive.value = Boolean(state.active)
        if (state.active) {
          indoorFloor.value = state.floor
          indoorFloors.value = state.floors || [state.floor]
          indoorBuildingName.value = state.buildingName || '教学楼'
          if (indoorDefinition.value) indoorDefinition.value.floors = indoorDefinition.value.floors.filter(floor => state.floors.includes(floor.level))
          nearIndoorStairs.value = Boolean(state.nearStairs)
          nearIndoorRoom.value = state.nearRoom || null
          activeIndoorRoom.value = state.activeRoom || null
          if (state.activeRoom) indoorPrompt.value = { visible: true, text: '按 E 返回走廊' }
          else if (state.nearRoom) indoorPrompt.value = { visible: true, text: `按 E 进入 ${state.nearRoom.roomName}` }
          else if (state.nearStairs) indoorPrompt.value = { visible: true, text: '按 E 沿楼梯上下楼' }
          else indoorPrompt.value = null
        } else {
          indoorFloor.value = 1; indoorFloors.value = [1]; nearIndoorStairs.value = false
          indoorEditorOpen.value = false
          nearIndoorRoom.value = null; activeIndoorRoom.value = null; indoorPrompt.value = null
        }
      },
      onReady: () => {
        loading.value = false
        engineReady.value = true
      },
      onError: (error) => {
        errorMessage.value = error?.message || '三维场景初始化失败'
        loading.value = false
      },
    }, { sceneType: requestedBuildingId ? 'campus' : (isRpgSample ? 'rpg-sample' : 'campus'), initialPlayerPosition: returnWorldPosition })
    await engine.init()
    if (requestedBuildingId && CAMPUS_BUILDING_FOOTPRINTS.some(item => item.id === requestedBuildingId)) await enterSelectedBuilding()
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
    <CampusPixelMap v-if="!showEditor" :initial-player-position="returnPixelPosition" @enter-building="openBuildingFromPixelMap" />
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
        <span class="topbar-status"><span class="status-dot"></span> {{ indoorPrototypeActive ? '室内空间样板 · 非实测布局' : '宝可梦风格 · 2.5D 校园样板' }}</span>
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

    <div v-if="indoorPrototypeActive" class="indoor-floor-hud"><strong>{{ indoorBuildingName }}</strong><span>{{ indoorFloor }} 楼 · 共 {{ indoorFloors.length }} 层</span><small>靠近楼梯后按 E 上楼或下楼</small><button @click="closeEditor">返回校园</button></div>
    <aside v-if="indoorPrototypeActive && indoorEditorOpen" class="indoor-layout-editor">
      <header><strong>室内空间编辑器</strong><small>建筑 {{ indoorBuildingId }} · {{ indoorFloor }}F</small></header>
      <div class="indoor-editor-actions"><button @click="addIndoorFloor">＋ 增加楼层</button><button :disabled="indoorFloors.length <= 1" @click="removeIndoorFloor">删除当前层</button><button @click="addIndoorRoom">＋ 添加房间</button></div>
      <section class="indoor-footprint-tools">
        <strong>建筑外观与层高</strong>
        <div class="indoor-room-fields">
          <label>层高（米）<input v-model.number="indoorDefinition.floorHeight" type="number" min="2.8" max="6" step="0.1" @change="updateBuildingHeight"></label>
          <label>屋顶样式
            <select v-model="indoorDefinition.exterior.roofStyle" @change="refreshIndoorLayout">
              <option value="flat">现代平屋顶</option>
              <option value="glass">玻璃屋顶</option>
              <option value="pitched">双坡屋顶（规则轮廓）</option>
            </select>
          </label>
        </div>
        <small>当前建筑 {{ indoorDefinition.floors.length }} 层 · 总高度约 {{ (indoorDefinition.floorHeight * indoorDefinition.floors.length).toFixed(1) }} 米；复杂轮廓的双坡顶会安全回退为平顶</small>
      </section>
      <section class="indoor-footprint-tools">
        <strong>建筑占地扩建</strong>
        <small>按校园底图建筑轮廓为基准；每次向指定方向扩展 2 个场景单位</small>
        <div class="indoor-expansion-buttons">
          <button @click="expandCurrentBuilding('north')">北侧＋</button>
          <button @click="expandCurrentBuilding('south')">南侧＋</button>
          <button @click="expandCurrentBuilding('west')">西侧＋</button>
          <button @click="expandCurrentBuilding('east')">东侧＋</button>
        </div>
        <small v-if="indoorDefinition?.footprintSize">当前占地：{{ indoorDefinition.footprintSize.width.toFixed(1) }} × {{ indoorDefinition.footprintSize.depth.toFixed(1) }}</small>
      </section>
      <BuildingFootprintEditor :definition="indoorDefinition" @change="refreshIndoorLayout" />
      <IndoorFloorPlanEditor :floor="activeEditableFloor" @change="refreshIndoorLayout" />
      <div class="indoor-room-list"><section v-for="room in activeEditableFloor?.rooms || []" :key="room.id" class="indoor-room-item">
        <div class="indoor-room-title"><input v-model="room.name" aria-label="房间名称" @change="refreshIndoorLayout"><button @click="removeIndoorRoom(room.id)">删除</button></div>
        <div class="indoor-room-fields"><label>X<input v-model.number="room.x" type="number" step="0.5" @change="refreshIndoorLayout"></label><label>Z<input v-model.number="room.z" type="number" step="0.5" @change="refreshIndoorLayout"></label><label>宽<input v-model.number="room.width" type="number" min="2" step="0.5" @change="refreshIndoorLayout"></label><label>深<input v-model.number="room.depth" type="number" min="2" step="0.5" @change="refreshIndoorLayout"></label></div>
      </section></div><div class="indoor-layout-actions"><button class="indoor-save-layout" :disabled="indoorLayoutSaving" @click="saveIndoorLayout">{{ indoorLayoutSaving ? "保存中…" : "保存室内布局" }}</button><button class="indoor-history-button" @click="loadIndoorLayoutVersions">历史版本</button></div><div v-if="indoorHistoryOpen" class="indoor-history-list"><div v-if="!indoorLayoutVersions.length">暂无历史版本</div><div v-for="version in indoorLayoutVersions" :key="version.revision" class="indoor-history-item"><span>版本 {{ version.revision }} · {{ new Date(version.created_at).toLocaleString() }}</span><button :disabled="indoorLayoutSaving || Number(version.revision) === indoorLayoutRevision" @click="restoreIndoorLayoutVersion(version.revision)">恢复</button></div></div><p>{{ indoorEditorMessage }}</p>
    </aside>
    <div v-if="indoorPrompt" class="indoor-interaction-prompt">{{ indoorPrompt.text }}</div>
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
