<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({ definition: { type: Object, default: null } })
const emit = defineEmits(['change'])
const svg = ref(null)
const selected = ref(-1)
const drag = ref(null)
const view = { width: 520, height: 360, padding: 34 }
const bounds = computed(() => props.definition?.footprint?.bounds || {
  minX: -(props.definition?.footprintSize?.width || 12) / 2,
  maxX: (props.definition?.footprintSize?.width || 12) / 2,
  minZ: -(props.definition?.footprintSize?.depth || 12) / 2,
  maxZ: (props.definition?.footprintSize?.depth || 12) / 2,
})
const scale = computed(() => Math.min(
  (view.width - view.padding * 2) / Math.max(1, bounds.value.maxX - bounds.value.minX),
  (view.height - view.padding * 2) / Math.max(1, bounds.value.maxZ - bounds.value.minZ),
))
const center = computed(() => ({ x: view.width / 2, y: view.height / 2 }))
const points = computed(() => (props.definition?.footprint?.polygon || []).map(point => ({
  ...point, px: center.value.x + point.x * scale.value, py: center.value.y + point.z * scale.value,
})))
const polygonPoints = computed(() => points.value.map(point => point.px + ',' + point.py).join(' '))
function ensurePolygon() {
  const footprint = props.definition?.footprint
  if (!footprint) return
  if (!Array.isArray(footprint.polygon) || footprint.polygon.length < 3) {
    const b = bounds.value
    footprint.polygon = [
      { x: b.minX, z: b.minZ }, { x: b.maxX, z: b.minZ },
      { x: b.maxX, z: b.maxZ }, { x: b.minX, z: b.maxZ },
    ]
  }
}
watch(() => props.definition?.footprint, ensurePolygon, { immediate: true })
function pointFromEvent(event) {
  const rect = svg.value.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width * view.width
  const y = (event.clientY - rect.top) / rect.height * view.height
  return { x: (x - center.value.x) / scale.value, z: (y - center.value.y) / scale.value }
}
function startPointDrag(event, index) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  selected.value = index
  drag.value = { pointerId: event.pointerId, index }
  svg.value?.setPointerCapture?.(event.pointerId)
}
function movePoint(event) {
  if (!drag.value || drag.value.pointerId !== event.pointerId) return
  const point = pointFromEvent(event)
  const b = bounds.value
  const margin = 0.25
  const next = {
    x: Math.max(b.minX + margin, Math.min(b.maxX - margin, point.x)),
    z: Math.max(b.minZ + margin, Math.min(b.maxZ - margin, point.z)),
  }
  props.definition.footprint.polygon[drag.value.index] = { x: round(next.x), z: round(next.z) }
}
function endPointDrag(event) {
  if (!drag.value || (event?.pointerId !== undefined && drag.value.pointerId !== event.pointerId)) return
  drag.value = null
  emit('change')
}
function addVertex() {
  ensurePolygon()
  const polygon = props.definition.footprint.polygon
  if (polygon.length >= 32) return
  let longest = 0, edge = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (length > longest) { longest = length; edge = i }
  }
  const a = polygon[edge], b = polygon[(edge + 1) % polygon.length]
  polygon.splice(edge + 1, 0, { x: round((a.x + b.x) / 2), z: round((a.z + b.z) / 2) })
  selected.value = edge + 1
  emit('change')
}
function removeVertex() {
  const polygon = props.definition?.footprint?.polygon
  if (!polygon || polygon.length <= 3 || selected.value < 0) return
  polygon.splice(selected.value, 1)
  selected.value = Math.min(selected.value, polygon.length - 1)
  emit('change')
}
function resetRectangle() {
  const b = bounds.value
  props.definition.footprint.polygon = [
    { x: b.minX, z: b.minZ }, { x: b.maxX, z: b.minZ },
    { x: b.maxX, z: b.maxZ }, { x: b.minX, z: b.maxZ },
  ]
  selected.value = -1
  emit('change')
}
function round(value) { return Math.round(value * 10) / 10 }
</script>

<template>
  <section v-if="definition?.footprint" class="footprint-editor">
    <header><strong>建筑轮廓 · {{ points.length }} 个顶点</strong><span>拖动节点调整外轮廓</span></header>
    <svg ref="svg" viewBox="0 0 520 360" role="img" aria-label="建筑多边形轮廓编辑器"
      @pointermove="movePoint" @pointerup="endPointDrag" @pointercancel="endPointDrag" @lostpointercapture="endPointDrag">
      <rect width="520" height="360" fill="#f6f8f3"/>
      <g stroke="#e4e9e1" stroke-width="1">
        <path v-for="n in 24" :key="'v'+n" :d="'M '+(34+n*18)+' 20 V 340'"/>
        <path v-for="n in 16" :key="'h'+n" :d="'M 20 '+(20+n*20)+' H 500'"/>
      </g>
      <polygon v-if="points.length >= 3" :points="polygonPoints" fill="#dce9d9" stroke="#547a5b" stroke-width="3"/>
      <g v-for="(point,index) in points" :key="index">
        <circle :cx="point.px" :cy="point.py" r="9" :fill="selected === index ? '#d56b35' : '#477b54'" stroke="#fff" stroke-width="2" @pointerdown="startPointDrag($event,index)"/>
        <text :x="point.px+11" :y="point.py-10" font-size="11" fill="#53665a">{{ index+1 }}</text>
      </g>
    </svg>
    <footer>
      <button @click="addVertex" :disabled="points.length >= 32">＋ 添加顶点</button>
      <button @click="removeVertex" :disabled="points.length <= 3 || selected < 0">删除选中顶点</button>
      <button @click="resetRectangle">恢复矩形</button>
    </footer>
    <small>当前版本支持在原始占地包围范围内调整轮廓；顶点数据会保存。外墙/屋顶的多边形实体重建仍需下一阶段接入。</small>
  </section>
</template>

<style scoped>
.footprint-editor{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid #dce4dc;border-radius:5px;background:#fff}.footprint-editor header,.footprint-editor footer{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}.footprint-editor header strong{font-size:12px;color:#405548}.footprint-editor header span,.footprint-editor small{font-size:10px;color:#78857a}.footprint-editor svg{width:100%;height:auto;max-height:340px;border:1px solid #e1e7df;border-radius:4px;touch-action:none;user-select:none}.footprint-editor circle{cursor:grab}.footprint-editor button{padding:5px 8px;border:1px solid #cbd7cc;border-radius:4px;background:#fff;color:#42604b;font-size:10px}.footprint-editor button:disabled{opacity:.4;cursor:not-allowed}
</style>
