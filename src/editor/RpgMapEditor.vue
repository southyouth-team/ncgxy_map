<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { createRpgMapDocument, TILE_PALETTE, RPG_OBJECT_PALETTE, paintTile } from './rpgMapDocument.js'
import { CAMPUS_BUILDING_ASSET_CATALOG, drawPixelBuildingPreview } from '../three/world/campus/campusAssetLibrary.js'

const emit = defineEmits(['close', 'switch-view'])
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'
const map = ref(createRpgMapDocument())
const campusId = ref(null)
const mapId = ref(null)
const revision = ref(0)
const saving = ref(false)
const loading = ref(true)
const canvas = ref(null)
const selectedTile = ref('grass')
const selectedObject = ref(null)
const activeLayerId = ref('ground')
const zoom = ref(2)
const tool = ref('brush')
const painting = ref(false)
const status = ref('正在加载地图文档…')
const activeLayer = computed(() => map.value.layers.find(layer => layer.id === activeLayerId.value))
const tileColor = id => TILE_PALETTE.find(tile => tile.id === id)?.color || 'transparent'

function draw() {
  const element = canvas.value
  if (!element) return
  const { width, height, tileSize } = map.value.grid
  const context = element.getContext('2d')
  element.width = width * tileSize
  element.height = height * tileSize
  context.imageSmoothingEnabled = false
  for (const layer of map.value.layers) {
    if (!layer.visible) continue
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = layer.tiles[y][x]
        if (!tile) continue
        context.fillStyle = tileColor(tile)
        context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
      }
    }
  }
  context.strokeStyle = 'rgba(30,48,31,.16)'
  context.lineWidth = 0.5
  for (let x = 0; x <= width; x++) {
    context.beginPath(); context.moveTo(x * tileSize + .5, 0); context.lineTo(x * tileSize + .5, height * tileSize); context.stroke()
  }
  for (let y = 0; y <= height; y++) {
    context.beginPath(); context.moveTo(0, y * tileSize + .5); context.lineTo(width * tileSize, y * tileSize + .5); context.stroke()
  }
  for (const object of map.value.objects) {
    const buildingAsset = CAMPUS_BUILDING_ASSET_CATALOG.find(item => item.id === object.assetId)
    if (object.kind === 'building' && buildingAsset) {
      drawPixelBuildingPreview(context, { x: object.x, y: object.y, width: object.width, height: object.height, tileSize, template: object.template || buildingAsset.template, selected: object.id === selectedObject.value })
      continue
    }
    const asset = RPG_OBJECT_PALETTE.find(item => item.id === object.assetId)
    const w = Number(object.width || asset?.width || 1), h = Number(object.height || asset?.height || 1)
    context.fillStyle = object.color || asset?.color || '#285c3b'; context.globalAlpha = .24
    context.fillRect(object.x*tileSize,object.y*tileSize,w*tileSize,h*tileSize); context.globalAlpha=1
    context.strokeStyle=object.color||asset?.color||'#285c3b'; context.lineWidth=2
    context.strokeRect(object.x*tileSize+1,object.y*tileSize+1,w*tileSize-2,h*tileSize-2)
    context.font='bold 14px monospace'; context.textAlign='center'; context.textBaseline='middle'
    context.fillText(object.glyph||'◆',(object.x+w/2)*tileSize,(object.y+h/2)*tileSize)
  }
}
function getCell(event) {
  const rect = canvas.value.getBoundingClientRect()
  return {
    x: Math.floor((event.clientX - rect.left) / rect.width * map.value.grid.width),
    y: Math.floor((event.clientY - rect.top) / rect.height * map.value.grid.height),
  }
}
function applyAt(event) {
  const { x, y } = getCell(event)
  if (tool.value === 'object' && selectedObject.value) {
    const building = CAMPUS_BUILDING_ASSET_CATALOG.find(entry => entry.id === selectedObject.value)
    if (building && x >= 0 && y >= 0 && x + building.width <= map.value.grid.width && y + building.height <= map.value.grid.height) {
      map.value.objects.push({ id: `building-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, kind: 'building', assetId: building.id, template: building.template, name: building.label, x, y, width: building.width, height: building.height, rotation: 0 })
      draw()
      return
    }
    const item = RPG_OBJECT_PALETTE.find(entry => entry.id === selectedObject.value)
    if (item && x >= 0 && y >= 0 && x + item.width <= map.value.grid.width && y + item.height <= map.value.grid.height) {
      map.value.objects.push({ id: `obj-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, kind: 'decoration', assetId: item.id, x, y, width: item.width, height: item.height, rotation: 0, glyph: item.glyph, color: item.color })
      draw()
    }
    return
  }
  if (paintTile(map.value, activeLayerId.value, x, y, selectedTile.value)) draw()
}
function pointerDown(event) {
  painting.value = true
  canvas.value.setPointerCapture?.(event.pointerId)
  applyAt(event)
}
function pointerMove(event) { if (painting.value) applyAt(event) }
function pointerUp() { painting.value = false }
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': USER_ID, ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || `请求失败：HTTP ${response.status}`)
  return payload
}

async function loadMapDocument() {
  loading.value = true
  try {
    const campuses = await api('/campuses')
    const campus = campuses.find(item => item.slug === 'ncgxy')
    if (!campus) throw new Error('地图服务中尚未初始化南昌工学院校园')
    campusId.value = String(campus.id)
    const maps = await api(`/campuses/${campus.id}/maps`)
    const campusMap = maps.find(item => item.slug === 'main') || maps[0]
    if (!campusMap) throw new Error('当前校园尚未创建主地图')
    mapId.value = String(campusMap.id)
    const saved = await api(`/campuses/${campusId.value}/maps/${mapId.value}/scene/rpg`)
    revision.value = Number(saved.revision || 0)
    if (saved.document) map.value = saved.document
    map.value.mapId = mapId.value
    map.value.campusId = campusId.value
    status.value = saved.document ? `已加载服务端地图 · 版本 ${revision.value}` : '已连接地图服务 · 新建草稿'
    draw()
  } catch (error) {
    status.value = `加载失败：${error.message}`
  } finally {
    loading.value = false
  }
}

async function saveMapDocument() {
  if (!campusId.value || !mapId.value || saving.value) return
  saving.value = true
  try {
    map.value.mapId = mapId.value
    map.value.campusId = campusId.value
    const saved = await api(`/campuses/${campusId.value}/maps/${mapId.value}/scene/rpg`, {
      method: 'PUT',
      body: JSON.stringify({ revision: revision.value, document: map.value }),
    })
    revision.value = Number(saved.revision)
    map.value = saved.document
    status.value = `已保存至服务器 · 版本 ${revision.value}`
  } catch (error) {
    status.value = error.message.includes('409') || error.message.includes('版本冲突')
      ? '保存冲突：其他编辑者已更新，请刷新后再操作'
      : `保存失败：${error.message}`
  } finally {
    saving.value = false
    draw()
  }
}

function saveDraft() {
  const blob = new Blob([JSON.stringify(map.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'ncgxy-rpg-map-draft.json'
  anchor.click()
  URL.revokeObjectURL(url)
  status.value = '已导出本地 JSON 文件'
}
watch([zoom, activeLayerId], draw)
onMounted(loadMapDocument)
</script>

<template>
  <section class="rpg-editor">
    <header class="rpg-topbar">
      <div class="rpg-brand"><span class="rpg-mark">NC</span><div><strong>南昌工学院地图搭建器</strong><small>TOP-DOWN PIXEL MAP EDITOR</small></div></div>
      <div class="rpg-actions">
        <span class="rpg-status">{{ status }}</span>
        <button :disabled="saving || loading" @click="saveMapDocument">{{ saving ? '保存中…' : '保存地图' }}</button>
        <button @click="saveDraft">导出 JSON</button>
        <button @click="emit('switch-view', '3d', map)">三维预览</button>
        <button class="rpg-close" @click="emit('close')">退出编辑模式</button>
      </div>
    </header>
    <div class="rpg-workspace">
      <aside class="rpg-assets">
        <h3>素材库</h3>
        <div class="rpg-section-title">地面瓦片</div>
        <button v-for="tile in TILE_PALETTE" :key="tile.id" :class="['rpg-asset', { chosen: tool === 'brush' && selectedTile === tile.id }]" @click="tool='brush'; selectedTile=tile.id">
          <i :style="{ background: tile.color }"></i>{{ tile.label }}
        </button>
        <div class="rpg-section-title">建筑资产（二维/三维共用）</div>
        <button v-for="item in CAMPUS_BUILDING_ASSET_CATALOG" :key="item.id" :class="['rpg-asset', { chosen: tool === 'object' && selectedObject === item.id }]" @click="tool='object'; selectedObject=item.id">
          <i class="rpg-glyph" :style="{ color: item.color }">{{ item.glyph }}</i>{{ item.label }}
        </button>
        <div class="rpg-section-title">场景装饰</div>
        <button v-for="item in RPG_OBJECT_PALETTE" :key="item.id" :class="['rpg-asset', { chosen: tool === 'object' && selectedObject === item.id }]" @click="tool='object'; selectedObject=item.id">
          <i class="rpg-glyph" :style="{ color: item.color }">{{ item.glyph }}</i>{{ item.label }}
        </button>
        <p class="rpg-note">当前为基础占位素材。地图文档已接入服务端版本化保存。专属校园建筑素材和自动拼接规则后续补充。</p>
      </aside>
      <main class="rpg-stage">
        <div class="rpg-stage-toolbar">
          <strong>地图画布 · {{ map.grid.width }} × {{ map.grid.height }}</strong>
          <div><button @click="zoom=Math.max(1,zoom-1)">−</button><span>{{ zoom * 100 }}%</span><button @click="zoom=Math.min(4,zoom+1)">＋</button></div>
        </div>
        <div class="rpg-canvas-scroll">
          <canvas ref="canvas" :style="{ width: (map.grid.width * map.grid.tileSize * zoom) + 'px', height: (map.grid.height * map.grid.tileSize * zoom) + 'px' }" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" />
        </div>
      </main>
      <aside class="rpg-inspector">
        <h3>图层与属性</h3>
        <div class="rpg-section-title">当前图层</div>
        <button v-for="layer in map.layers" :key="layer.id" :class="['rpg-layer', { chosen: activeLayerId === layer.id }]" @click="activeLayerId=layer.id">
          <span>{{ layer.name }}</span><small>{{ layer.type }}</small>
        </button>
        <div class="rpg-section-title">地图信息</div>
        <label>地图名称<input v-model="map.name"></label>
        <label>网格宽度<input :value="map.grid.width" disabled></label>
        <label>网格高度<input :value="map.grid.height" disabled></label>
        <div class="rpg-callout">地图文档保存在服务端并进行版本冲突检测。建筑等真实空间对象仍关联 GIS Feature，不在瓦片层重复保存轮廓。</div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.rpg-editor{height:100%;min-height:100vh;background:#18271e;color:#e8e0c4;font-family:ui-monospace,SFMono-Regular,monospace;display:flex;flex-direction:column}
.rpg-topbar{height:68px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:2px solid #42563e;background:#202f24}
.rpg-brand,.rpg-actions{display:flex;align-items:center;gap:14px}.rpg-brand strong{display:block;font-size:14px}.rpg-brand small{display:block;color:#a6ae8b;font-size:9px;margin-top:4px;letter-spacing:1px}
.rpg-mark{display:grid;place-items:center;width:38px;height:38px;background:#c6a85f;color:#273526;border:2px solid #e5d39c;font-weight:900}
.rpg-actions button,.rpg-stage-toolbar button{background:#354b37;border:2px solid #72815c;color:#f0e6c5;padding:8px 12px;cursor:pointer;font:inherit}.rpg-actions .rpg-close{background:#b58a55;color:#20291e;border-color:#d5b77d}
.rpg-status{font-size:10px;color:#b8c09d}.rpg-workspace{display:grid;grid-template-columns:190px minmax(0,1fr) 220px;flex:1;min-height:0}
.rpg-assets,.rpg-inspector{padding:16px 12px;background:#223328;overflow:auto;border-right:2px solid #42563e}.rpg-inspector{border-right:0;border-left:2px solid #42563e}.rpg-assets h3,.rpg-inspector h3{font-size:12px;margin:0 0 18px;color:#e6d5a5}
.rpg-section-title{font-size:10px;color:#bca66e;margin:14px 0 8px;text-transform:uppercase;letter-spacing:1px}
.rpg-asset,.rpg-layer{display:flex;align-items:center;gap:9px;width:100%;padding:8px;margin:3px 0;text-align:left;background:#293d30;border:1px solid #52654a;color:#e8e0c4;font:inherit;font-size:11px;cursor:pointer}
.rpg-asset.chosen,.rpg-layer.chosen{border-color:#d4b66c;background:#40513b}.rpg-asset i{width:20px;height:20px;border:1px solid #b6b08a;display:grid;place-items:center}.rpg-asset .rpg-glyph{background:#344634;font-style:normal;font-size:17px}
.rpg-note,.rpg-callout{font-size:10px;line-height:1.7;color:#aeb79b;margin-top:16px;padding:10px;background:#1b2b21;border:1px solid #4b6046}
.rpg-stage{min-width:0;display:flex;flex-direction:column}.rpg-stage-toolbar{height:48px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:#202f24;border-bottom:1px solid #42563e;font-size:11px}.rpg-stage-toolbar div{display:flex;align-items:center;gap:10px}.rpg-stage-toolbar button{padding:3px 10px}
.rpg-canvas-scroll{flex:1;overflow:auto;padding:28px;background-color:#18271e;background-image:radial-gradient(#52634a 1px,transparent 1px);background-size:16px 16px}
.rpg-canvas-scroll canvas{display:block;image-rendering:pixelated;cursor:crosshair;box-shadow:0 8px 30px #101a13;touch-action:none}
.rpg-layer{justify-content:space-between}.rpg-layer small{color:#aab28e}
.rpg-inspector label{display:block;font-size:10px;color:#c9c19f;margin:10px 0}.rpg-inspector input{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:7px;background:#17271e;border:1px solid #536449;color:#eee2c2;font:inherit;font-size:11px}
@media(max-width:800px){.rpg-workspace{grid-template-columns:130px minmax(0,1fr)}.rpg-inspector{display:none}.rpg-topbar{padding:0 10px}.rpg-status{display:none}.rpg-assets{padding:10px 6px}}
</style>
