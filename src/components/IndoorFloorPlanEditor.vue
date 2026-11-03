<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ floor: { type: Object, default: null } })
const emit = defineEmits(['change'])
const svgRef = ref(null)
const selectedRoomId = ref('')
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
  const room = props.floor?.rooms?.find(item => item.id === state.roomId)
  if (!room) return
  if (state.mode === 'move') {
    const maxX = props.floor.width / 2 - room.width / 2
    const maxZ = props.floor.depth / 2 - room.depth / 2
    room.x = Math.round(Math.max(-maxX, Math.min(maxX, state.x + dx)) * 10) / 10
    room.z = Math.round(Math.max(-maxZ, Math.min(maxZ, state.z + dz)) * 10) / 10
  } else {
    const maxWidth = props.floor.width / 2 - state.x + state.width / 2
    const maxDepth = props.floor.depth / 2 - state.z + state.depth / 2
    const width = Math.min(maxWidth, Math.max(2, state.width + dx))
    const depth = Math.min(maxDepth, Math.max(2, state.depth + dz))
    room.width = Math.round(width * 10) / 10
    room.depth = Math.round(depth * 10) / 10
    room.x = Math.round((state.x + (room.width - state.width) / 2) * 10) / 10
    room.z = Math.round((state.z + (room.depth - state.depth) / 2) * 10) / 10
  }
}
function endDrag(event) {
  if (!dragState.value || (event?.pointerId !== undefined && dragState.value.pointerId !== event.pointerId)) return
  dragState.value = null
  emit('change')
}
function roomLabel(room) { return room.name || '未命名空间' }
</script>

<template>
  <div class="floor-plan-editor">
    <div class="plan-toolbar"><span>平面布局 · {{ floor?.width }} × {{ floor?.depth }} m</span><span>拖动房间移动 · 拖右下角调整尺寸</span></div>
    <svg v-if="floor && boundary" ref="svgRef" class="floor-plan-canvas" viewBox="0 0 640 440" role="img" aria-label="室内楼层平面编辑画布" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
      <defs><pattern id="indoor-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e6e9e1" stroke-width="1"/></pattern></defs>
      <rect width="640" height="440" fill="#f7f8f3"/>
      <rect width="640" height="440" fill="url(#indoor-grid)"/>
      <rect :x="boundary.x" :y="boundary.y" :width="boundary.width" :height="boundary.height" class="floor-boundary"/>
      <text :x="boundary.x + 8" :y="boundary.y - 10" class="boundary-label">建筑室内边界</text>
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
    <div class="plan-legend"><span><i class="legend-room"/>房间</span><span><i class="legend-stair"/>楼梯位置</span><span><i class="legend-spawn"/>出生点</span></div>
  </div>
</template>

<style scoped>
.floor-plan-editor{display:flex;flex-direction:column;gap:7px;min-height:260px}.plan-toolbar{display:flex;justify-content:space-between;gap:8px;color:#718075;font-size:10px}.floor-plan-canvas{display:block;width:100%;height:auto;max-height:48vh;border:1px solid #dce3d9;border-radius:4px;touch-action:none;user-select:none}.floor-boundary{fill:#fffefa;stroke:#65796b;stroke-width:3}.boundary-label{font-size:10px;fill:#718075}.room-shape{fill:#dce9d9;stroke:#66866b;stroke-width:2;cursor:move}.room-shape.selected{fill:#c8e0c8;stroke:#2d7148;stroke-width:3}.room-name{font-size:13px;font-weight:700;fill:#34483a;pointer-events:none}.room-size{font-size:10px;fill:#65786a;pointer-events:none}.resize-handle{fill:#2f7048;stroke:#fff;stroke-width:2;cursor:nwse-resize}.stair-marker rect{fill:#e9d6a6;stroke:#9d8044;stroke-width:1.5}.stair-marker text{font-size:10px;fill:#6f5729}.spawn-marker circle{fill:#d98d75;stroke:#fff;stroke-width:2}.spawn-marker text{font-size:10px;fill:#a75c49}.plan-legend{display:flex;gap:14px;color:#78847a;font-size:10px}.plan-legend span{display:flex;align-items:center;gap:5px}.plan-legend i{width:9px;height:9px;border-radius:2px;display:inline-block}.legend-room{background:#dce9d9;border:1px solid #66866b}.legend-stair{background:#e9d6a6}.legend-spawn{background:#d98d75}.plan-empty{padding:40px;text-align:center;color:#89958b;background:#f5f7f2}
</style>
