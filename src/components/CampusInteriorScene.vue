<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  interior: { type: Object, required: true },
  floorId: { type: String, default: '' },
})
const emit = defineEmits(['exit', 'floor-change'])
const player = ref({ x: 48, y: 48, direction: 'down' })
const activeFloor = computed(() => {
  const floors = Array.isArray(props.interior?.floors) ? props.interior.floors : []
  return floors.find(floor => floor.id === (props.floorId || floors[0]?.id)) || null
})
const dimensions = computed(() => ({
  width: Math.max(160, Number(activeFloor.value?.width) || 640),
  height: Math.max(120, Number(activeFloor.value?.height) || 420),
}))
const rooms = computed(() => Array.isArray(activeFloor.value?.rooms) ? activeFloor.value.rooms : [])
const walls = computed(() => Array.isArray(activeFloor.value?.walls) ? activeFloor.value.walls : [])
const stairs = computed(() => Array.isArray(activeFloor.value?.stairs) ? activeFloor.value.stairs : [])
const availableFloors = computed(() => Array.isArray(props.interior?.floors) ? props.interior.floors : [])
const playerTransform = computed(() => `translate(${player.value.x - 7}, ${player.value.y - 13})`)
const playerSize = 14

function pointInRect(x, y, rect, padding = 0) {
  if (!Array.isArray(rect) || rect.length !== 4) return false
  const [left, top, width, height] = rect
  return x + padding >= left && x - padding <= left + width
    && y + padding >= top && y - padding <= top + height
}

function isBlocked(x, y) {
  const { width, height } = dimensions.value
  if (x < 10 || y < 10 || x > width - 10 || y > height - 10) return true
  if (walls.value.some(wall => {
    const dx = wall.x2 - wall.x1
    const dy = wall.y2 - wall.y1
    const lengthSquared = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - wall.x1) * dx + (y - wall.y1) * dy) / lengthSquared))
    return Math.hypot(x - (wall.x1 + t * dx), y - (wall.y1 + t * dy)) < 9
  })) return true
  return rooms.value.some(room => room.solid === true && pointInRect(x, y, room.rect, 9))
}

function movePlayer(dx, dy, direction) {
  if (!activeFloor.value) return
  player.value.direction = direction
  const length = Math.hypot(dx, dy) || 1
  const step = 3 / length
  const nextX = player.value.x + dx * step
  const nextY = player.value.y + dy * step
  if (!isBlocked(nextX, player.value.y)) player.value.x = nextX
  if (!isBlocked(player.value.x, nextY)) player.value.y = nextY
}

function onKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const directions = {
    ArrowUp: [0, -1, 'up'], w: [0, -1, 'up'],
    ArrowDown: [0, 1, 'down'], s: [0, 1, 'down'],
    ArrowLeft: [-1, 0, 'left'], a: [-1, 0, 'left'],
    ArrowRight: [1, 0, 'right'], d: [1, 0, 'right'],
  }
  const direction = directions[event.key]
  if (!direction) return
  event.preventDefault()
  movePlayer(...direction)
}

function changeFloor(floorId) {
  const target = availableFloors.value.find(floor => floor.id === floorId)
  if (!target) return
  emit('floor-change', floorId)
  player.value = { x: 48, y: 48, direction: 'down' }
}

watch(() => [props.interior, props.floorId], () => {
  player.value = { x: 48, y: 48, direction: 'down' }
}, { deep: false })
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="campus-interior" aria-label="建筑室内探索场景">
    <header class="interior-toolbar">
      <div>
        <strong>{{ interior.buildingName || interior.buildingId }}</strong>
        <span>{{ activeFloor?.name || '楼层未配置' }}</span>
      </div>
      <div class="interior-actions">
        <label v-if="availableFloors.length">
          <span>楼层</span>
          <select :value="activeFloor?.id || ''" @change="changeFloor($event.target.value)">
            <option v-for="floor in availableFloors" :key="floor.id" :value="floor.id">{{ floor.name || floor.id }}</option>
          </select>
        </label>
        <button type="button" @click="emit('exit')">返回校园</button>
      </div>
    </header>
    <div v-if="!activeFloor" class="interior-empty">
      <strong>室内平面数据尚未配置</strong>
      <span>需要采集楼层尺寸、房间区域、墙体和楼梯位置后才能进入探索。</span>
    </div>
    <svg v-else class="interior-canvas" :viewBox="`0 0 ${dimensions.width} ${dimensions.height}`" role="img" :aria-label="`${activeFloor.name || '室内'}平面探索地图`">
      <rect x="0" y="0" :width="dimensions.width" :height="dimensions.height" rx="8" fill="#d9dfc8" />
      <g v-for="room in rooms" :key="room.id">
        <rect :x="room.rect?.[0]" :y="room.rect?.[1]" :width="room.rect?.[2]" :height="room.rect?.[3]" rx="2" :fill="room.fill || '#eee8d5'" stroke="#596b5d" stroke-width="3" />
        <text :x="room.rect?.[0] + room.rect?.[2] / 2" :y="room.rect?.[1] + room.rect?.[3] / 2" text-anchor="middle" dominant-baseline="middle" fill="#46594b" font-size="12">{{ room.name || room.id }}</text>
      </g>
      <line v-for="(wall, index) in walls" :key="`wall-${index}`" :x1="wall.x1" :y1="wall.y1" :x2="wall.x2" :y2="wall.y2" stroke="#596b5d" stroke-width="7" stroke-linecap="square" />
      <g v-for="stair in stairs" :key="stair.id" :transform="`translate(${stair.x}, ${stair.y})`">
        <rect x="-12" y="-12" width="24" height="24" rx="3" fill="#c58a5e" stroke="#704d37" stroke-width="2" />
        <path d="M -7 -6 H 7 M -7 0 H 7 M -7 6 H 7" stroke="#fff0d8" stroke-width="2" />
      </g>
      <g :transform="playerTransform">
        <ellipse cx="7" cy="14" rx="7" ry="3" fill="rgba(35,48,39,.24)" />
        <rect x="2" y="5" width="10" height="9" rx="2" fill="#52748a" stroke="#344c43" stroke-width="1" />
        <rect x="3" y="0" width="8" height="7" rx="3" fill="#e6bd91" stroke="#765b47" stroke-width="1" />
        <circle :cx="player.direction === 'left' ? 4 : player.direction === 'right' ? 10 : 5" cy="3" r="1" fill="#344a40" />
        <circle :cx="player.direction === 'left' ? 4 : player.direction === 'right' ? 10 : 10" cy="3" r="1" fill="#344a40" />
      </g>
    </svg>
    <footer class="interior-hint">WASD / 方向键移动 · 墙体碰撞 · 楼梯位置以采集数据为准</footer>
  </section>
</template>

<style scoped>
.campus-interior { display:flex; flex-direction:column; min-height:420px; height:100%; background:#e8eadb; border:1px solid #c8d0bd; border-radius:10px; overflow:hidden; color:#354a40; }
.interior-toolbar { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:12px 16px; background:#f7f5e9; border-bottom:1px solid #d4dacb; }
.interior-toolbar strong,.interior-toolbar span { display:block; }
.interior-toolbar span,.interior-hint { font-size:12px; color:#718071; margin-top:3px; }
.interior-actions { display:flex; align-items:center; gap:12px; }
.interior-actions label { display:flex; align-items:center; gap:6px; font-size:12px; }
.interior-actions select,.interior-actions button { border:1px solid #b8c2b1; border-radius:6px; background:#fffdf4; padding:7px 10px; color:#405648; }
.interior-empty { display:flex; flex:1; min-height:300px; flex-direction:column; align-items:center; justify-content:center; gap:8px; text-align:center; padding:24px; }
.interior-empty span { max-width:420px; color:#718071; font-size:13px; line-height:1.7; }
.interior-canvas { display:block; width:100%; flex:1; min-height:300px; max-height:calc(100vh - 220px); background:#d9dfc8; image-rendering:pixelated; touch-action:none; }
.interior-hint { padding:10px 14px; background:#f7f5e9; border-top:1px solid #d4dacb; }
@media (max-width:640px) { .interior-toolbar { align-items:flex-start; flex-direction:column; } .interior-canvas { min-height:260px; } }
</style>