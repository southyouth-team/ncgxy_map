<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ floor: { type: Object, default: null } })
const emit = defineEmits(['change'])
const svgRef = ref(null)
const selectedRoomId = ref('')
const selectedWallId = ref('')
const dragState = ref(null)
const view = { width: 640, height: 440, paddingX: 42, paddingY: 38 }
const scale = computed(() => {
  if (!props.floor) return 1
  return Math.min((view.width - view.paddingX * 2) / props.floor.width, (view.height - view.paddingY * 2) / props.floor.depth)
})
const origin = computed(() => ({ x: view.width / 2, z: view.height / 2 }))
const rooms = computed(() => (props.floor?.rooms || []).map(room => ({
  ...room,
  px: origin.value.x + room.x * scale.value,
  py: origin.value.z + room.z * scale.value,
  pw: room.width * scale.value,
  ph: room.depth * scale.value,
})))
const boundary = computed(() => props.floor ? {
  x: origin.value.x - props.floor.width * scale.value / 2,
  y: origin.value.z - props.floor.depth * scale.value / 2,
  width: props.floor.width * scale.value,
  height: props.floor.depth * scale.value,
} : null)
function worldPoint(event) {
  const rect = svgRef.value.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width * view.width
  const y = (event.clientY - rect.top) / rect.height * view.height
  return { x: (x - origin.value.x) / scale.value, z: (y - origin.value.z) / scale.value }
}
function startDrag(event, room, mode) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  selectedRoomId.value = room.id
  const point = worldPoint(event)
  dragState.value = {
    mode, roomId: room.id, pointerId: event.pointerId, startX: point.x, startZ: point.z,
    x: room.x, z: room.z, width: room.width, depth: room.depth,
  }
  svgRef.value?.setPointerCapture?.(event.pointerId)
}
function moveDrag(event) {
  const state = dragState.value
  if (!state || state.pointerId !== event.pointerId) return
  const point = worldPoint(event)
  const dx = point.x - state.startX
  const dz = point.z - state.startZ
  if (state.kind === 'wall') {
    const wall = props.floor?.walls?.find(item => item.id === state.id)
    if (!wall) return
    if (state.mode === 'move') {
      const maxX = props.floor.width / 2 - (wall.axis === 'x' ? wall.length / 2 : 0)
      const maxZ = props.floor.depth / 2 - (wall.axis === 'z' ? wall.length / 2 : 0)
      wall.x = round(Math.max(-maxX, Math.min(maxX, state.x + dx)))
      wall.z = round(Math.max(-maxZ, Math.min(maxZ, state.z + dz)))
    } else if (state.mode === 'resize') {
      const delta = wall.axis === 'x' ? dx : dz
      const signedDelta = state.endpoint === 'end' ? delta : -delta
      const axisLimit = (wall.axis === 'x' ? props.floor.width : props.floor.depth) / 2
      const anchor = state.endpoint === 'end' ? (wall.axis === 'x' ? state.x - state.length / 2 : state.z - state.length / 2)
        : (wall.axis === 'x' ? state.x + state.length / 2 : state.z + state.length / 2)
      const maxLength = state.endpoint === 'end' ? axisLimit - anchor + axisLimit : anchor + axisLimit
      const length = Math.max(1, Math.min(state.length + signedDelta, maxLength))
      const actualDelta = length - state.length
      wall.length = round(length)
      if (wall.axis === 'x') wall.x = round(state.x + (state.endpoint === 'end' ? actualDelta : -actualDelta) / 2)
      else wall.z = round(state.z + (state.endpoint === 'end' ? actualDelta : -actualDelta) / 2)
    } else if (state.mode === 'door') {
      const offset = wall.axis === 'x' ? dx : dz
      const maxOffset = Math.max(0, wall.length / 2 - (wall.doorWidth || 0) / 2)
      wall.doorOffset = round(Math.max(-maxOffset, Math.min(maxOffset, state.doorOffset + offset)))
    }
    return
  }
  const room = props.floor?.rooms?.find(item => item.id === state.roomId)
  if (!room) return
  if (state.mode === 'move') {
    const maxX = props.floor.width / 2 - room.width / 2
    const maxZ = props.floor.depth / 2 - room.depth / 2
    room.x = round(Math.max(-maxX, Math.min(maxX, state.x + dx)))
    room.z = round(Math.max(-maxZ, Math.min(maxZ, state.z + dz)))
  } else {
    const maxWidth = props.floor.width / 2 - state.x + state.width / 2
    const maxDepth = props.floor.depth / 2 - state.z + state.depth / 2
    const width = Math.min(maxWidth, Math.max(2, state.width + dx))
    const depth = Math.min(maxDepth, Math.max(2, state.depth + dz))
    room.width = round(width)
    room.depth = round(depth)
    room.x = round(state.x + (room.width - state.width) / 2)
    room.z = round(state.z + (room.depth - state.depth) / 2)
  }
}
function round(value) { return Math.round(value * 10) / 10 }
function startWallDrag(event, wall, mode = 'move', endpoint = null) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  selectedWallId.value = wall.id
  const point = worldPoint(event)
  dragState.value = {
    kind: 'wall', id: wall.id, mode, endpoint, pointerId: event.pointerId,
    startX: point.x, startZ: point.z, x: wall.x, z: wall.z,
    length: wall.length, doorOffset: wall.doorOffset || 0,
  }
  svgRef.value?.setPointerCapture?.(event.pointerId)
}
function endDrag(event) {
  if (!dragState.value || (event?.pointerId !== undefined && dragState.value.pointerId !== event.pointerId)) return
  dragState.value = null
  emit('change')
}
const walls = computed(() => (props.floor?.walls || []).map(wall => ({
  ...wall,
  x1: origin.value.x + (wall.x - (wall.axis === 'x' ? wall.length / 2 : 0)) * scale.value,
  y1: origin.value.z + (wall.z - (wall.axis === 'z' ? wall.length / 2 : 0)) * scale.value,
  x2: origin.value.x + (wall.x + (wall.axis === 'x' ? wall.length / 2 : 0)) * scale.value,
  y2: origin.value.z + (wall.z + (wall.axis === 'z' ? wall.length / 2 : 0)) * scale.value,
})))
function addWall(axis = 'x') {
  if (!props.floor) return
  if (!Array.isArray(props.floor.walls)) props.floor.walls = []
  const id = 'partition-' + Date.now()
  props.floor.walls.push({ id, axis, x: 0, z: axis === 'x' ? -2 : 0, length: Math.max(3, Math.min(8, axis === 'x' ? props.floor.width - 2 : props.floor.depth - 2)), height: props.floor.wallHeight * 0.82, thickness: 0.2, doorWidth: 0, doorOffset: 0 })
  selectedWallId.value = id
  emit('change')
}
function removeWall(id) {
  props.floor.walls = (props.floor.walls || []).filter(wall => wall.id !== id)
  if (selectedWallId.value === id) selectedWallId.value = ''
  emit('change')
}
function addExteriorDoor() {
  if (!props.floor) return
  if (!Array.isArray(props.floor.doors)) props.floor.doors = []
  props.floor.doors.push({ wall: 'south', offset: 0, width: 1.2 })
  emit('change')
}
function removeExteriorDoor(index) {
  props.floor.doors.splice(index, 1)
  emit('change')
}
function roomLabel(room) { return room.name || '未命名空间' }
</script>

<template>
  <div class="floor-plan-editor">
    <div class="plan-toolbar"><span>平面布局 · {{ floor?.width }} × {{ floor?.depth }} m</span><span>拖动房间或墙体移动 · 拖墙端点改长度 · 拖门洞改位置</span></div>
    <svg v-if="floor && boundary" ref="svgRef" class="floor-plan-canvas" viewBox="0 0 640 440" role="img" aria-label="室内楼层平面编辑画布" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
      <defs><pattern id="indoor-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e6e9e1" stroke-width="1"/></pattern></defs>
      <rect width="640" height="440" fill="#f7f8f3"/>
      <rect width="640" height="440" fill="url(#indoor-grid)"/>
      <rect :x="boundary.x" :y="boundary.y" :width="boundary.width" :height="boundary.height" class="floor-boundary"/>
      <text :x="boundary.x + 8" :y="boundary.y - 10" class="boundary-label">建筑室内边界</text>
      <g v-for="wall in walls" :key="wall.id">
        <line :x1="wall.x1" :y1="wall.y1" :x2="wall.x2" :y2="wall.y2" :class="['partition-line', { selected: selectedWallId === wall.id }]" @pointerdown="startWallDrag($event, wall, 'move')"/>
        <template v-if="selectedWallId === wall.id">
          <circle :cx="wall.x1" :cy="wall.y1" r="6" class="wall-handle" @pointerdown="startWallDrag($event, wall, 'resize', 'start')"/>
          <circle :cx="wall.x2" :cy="wall.y2" r="6" class="wall-handle" @pointerdown="startWallDrag($event, wall, 'resize', 'end')"/>
        </template>
        <line v-if="wall.doorWidth > 0" :x1="wall.axis === 'x' ? origin.x + (wall.x + (wall.doorOffset || 0) - wall.doorWidth/2) * scale : wall.x1" :y1="wall.axis === 'z' ? origin.z + (wall.z + (wall.doorOffset || 0) - wall.doorWidth/2) * scale : wall.y1" :x2="wall.axis === 'x' ? origin.x + (wall.x + (wall.doorOffset || 0) + wall.doorWidth/2) * scale : wall.x2" :y2="wall.axis === 'z' ? origin.z + (wall.z + (wall.doorOffset || 0) + wall.doorWidth/2) * scale : wall.y2" class="wall-door-gap" @pointerdown="startWallDrag($event, wall, 'door')"/>
      </g>
      <g v-for="room in rooms" :key="room.id">
        <rect :x="room.px - room.pw/2" :y="room.py - room.ph/2" :width="room.pw" :height="room.ph" rx="2" :class="['room-shape', { selected: selectedRoomId === room.id }]" @pointerdown="startDrag($event, room, 'move')"/>
        <text :x="room.px" :y="room.py - 3" text-anchor="middle" class="room-name">{{ roomLabel(room) }}</text>
        <text :x="room.px" :y="room.py + 13" text-anchor="middle" class="room-size">{{ room.width.toFixed(1) }} × {{ room.depth.toFixed(1) }} m</text>
        <circle v-if="selectedRoomId === room.id" :cx="room.px + room.pw/2" :cy="room.py + room.ph/2" r="7" class="resize-handle" @pointerdown="startDrag($event, room, 'resize')"/>
      </g>
      <g class="stair-marker" :transform="'translate(' + (origin.x + (floor.stairPoint?.x || 0) * scale) + ' ' + (origin.z + (floor.stairPoint?.z || 0) * scale) + ')'">
        <rect x="-18" y="-13" width="36" height="26" rx="3"/><text text-anchor="middle" y="4">楼梯</text>
      </g>
      <g class="spawn-marker" :transform="'translate(' + (origin.x + (floor.spawnPoint?.x || 0) * scale) + ' ' + (origin.z + (floor.spawnPoint?.z || 0) * scale) + ')'">
        <circle r="7"/><text x="11" y="4">出生点</text>
      </g>
    </svg>
    <div v-else class="plan-empty">当前楼层没有可编辑数据</div>
    <section v-if="floor" class="construction-editor">
      <div class="construction-heading"><strong>隔墙编辑</strong><div><button @click="addWall('x')">＋ 横向墙</button><button @click="addWall('z')">＋ 纵向墙</button></div></div>
      <div v-for="wall in floor.walls || []" :key="wall.id" class="construction-item" :class="{ active: selectedWallId === wall.id }" @click="selectedWallId = wall.id">
        <div class="construction-title"><b>{{ wall.axis === 'x' ? '横向隔墙' : '纵向隔墙' }}</b><button @click.stop="removeWall(wall.id)">删除</button></div>
        <div class="construction-fields">
          <label>X<input v-model.number="wall.x" type="number" step="0.5" @change="emit('change')"></label>
          <label>Z<input v-model.number="wall.z" type="number" step="0.5" @change="emit('change')"></label>
          <label>长度<input v-model.number="wall.length" type="number" min="1" step="0.5" @change="emit('change')"></label>
          <label>厚度<input v-model.number="wall.thickness" type="number" min="0.1" step="0.05" @change="emit('change')"></label>
        </div>
        <div class="construction-fields">
          <label>门宽<input v-model.number="wall.doorWidth" type="number" min="0" step="0.1" @change="emit('change')"></label>
          <label>门偏移<input v-model.number="wall.doorOffset" type="number" step="0.1" @change="emit('change')"></label>
        </div>
      </div>
      <div class="construction-heading"><strong>外墙门洞</strong><button @click="addExteriorDoor">＋ 添加门洞</button></div>
      <div v-for="(door, index) in floor.doors || []" :key="'door-' + index" class="construction-item">
        <div class="construction-title"><b>门洞 {{ index + 1 }}</b><button @click="removeExteriorDoor(index)">删除</button></div>
        <div class="construction-fields">
          <label>墙面<select v-model="door.wall" @change="emit('change')"><option value="north">北侧</option><option value="south">南侧</option><option value="east">东侧</option><option value="west">西侧</option></select></label>
          <label>偏移<input v-model.number="door.offset" type="number" step="0.1" @change="emit('change')"></label>
          <label>宽度<input v-model.number="door.width" type="number" min="0.7" step="0.1" @change="emit('change')"></label>
        </div>
      </div>
    </section>
    <div class="plan-legend"><span><i class="legend-room"/>房间</span><span><i class="legend-stair"/>楼梯位置</span><span><i class="legend-spawn"/>出生点</span></div>
  </div>
</template>

<style scoped>
.floor-plan-editor{display:flex;flex-direction:column;gap:7px;min-height:260px}.plan-toolbar{display:flex;justify-content:space-between;gap:8px;color:#718075;font-size:10px}.floor-plan-canvas{display:block;width:100%;height:auto;max-height:48vh;border:1px solid #dce3d9;border-radius:4px;touch-action:none;user-select:none}.floor-boundary{fill:#fffefa;stroke:#65796b;stroke-width:3}.boundary-label{font-size:10px;fill:#718075}.room-shape{fill:#dce9d9;stroke:#66866b;stroke-width:2;cursor:move}.room-shape.selected{fill:#c8e0c8;stroke:#2d7148;stroke-width:3}.room-name{font-size:13px;font-weight:700;fill:#34483a;pointer-events:none}.room-size{font-size:10px;fill:#65786a;pointer-events:none}.resize-handle{fill:#2f7048;stroke:#fff;stroke-width:2;cursor:nwse-resize}.stair-marker rect{fill:#e9d6a6;stroke:#9d8044;stroke-width:1.5}.stair-marker text{font-size:10px;fill:#6f5729}.spawn-marker circle{fill:#d98d75;stroke:#fff;stroke-width:2}.spawn-marker text{font-size:10px;fill:#a75c49}.plan-legend{display:flex;gap:14px;color:#78847a;font-size:10px}.plan-legend span{display:flex;align-items:center;gap:5px}.plan-legend i{width:9px;height:9px;border-radius:2px;display:inline-block}.legend-room{background:#dce9d9;border:1px solid #66866b}.legend-stair{background:#e9d6a6}.legend-spawn{background:#d98d75}.partition-line{stroke:#a56b42;stroke-width:5;stroke-linecap:square;pointer-events:stroke;cursor:move}.wall-handle{fill:#d26b35;stroke:#fff;stroke-width:2;cursor:crosshair;pointer-events:all}.partition-line.selected{stroke:#d26b35;stroke-width:6}.wall-door-gap{stroke:#f7f8f3;stroke-width:9;pointer-events:stroke;cursor:ew-resize}.construction-editor{display:flex;flex-direction:column;gap:7px}.construction-heading,.construction-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#45594a}.construction-heading button,.construction-title button{padding:4px 7px;border:1px solid #cbd4ca;border-radius:3px;background:white;color:#3f634c;font-size:10px}.construction-heading div{display:flex;gap:5px}.construction-item{padding:8px;border:1px solid #dce3d9;border-radius:4px;background:#fff}.construction-item.active{border-color:#7b9d7c}.construction-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:7px}.construction-fields label{display:flex;flex-direction:column;gap:3px;font-size:9px;color:#77847a}.construction-fields input,.construction-fields select{width:100%;min-width:0;padding:5px;border:1px solid #d7ded7;border-radius:3px;font-size:10px}.plan-empty{padding:40px;text-align:center;color:#89958b;background:#f5f7f2}
</style>
