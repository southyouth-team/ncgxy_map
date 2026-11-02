<script setup>
import { ref, watch } from 'vue'
import { solveAffineTransform } from './affineTransform.js'

const props = defineProps({
  imageWidth: { type: Number, default: 0 },
  imageHeight: { type: Number, default: 0 },
  currentRegistration: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['apply'])
const rows = ref([
  { sx: 0, sy: 0, tx: 0, ty: 0 },
  { sx: 100, sy: 0, tx: 100, ty: 0 },
  { sx: 0, sy: 100, tx: 0, ty: 100 },
])
const result = ref(null)
const localError = ref('')
watch(() => props.currentRegistration, value => { result.value = value || null }, { immediate: true })
function addPoint() { rows.value.push({ sx: 0, sy: 0, tx: 0, ty: 0 }) }
function removePoint(index) { if (rows.value.length > 3) rows.value.splice(index, 1) }
function calculate() {
  localError.value = ''
  try {
    const controlPoints = rows.value.map(row => ({ source: [Number(row.sx), Number(row.sy)], target: [Number(row.tx), Number(row.ty)] }))
    result.value = solveAffineTransform(controlPoints)
    emit('apply', { ...result.value, controlPoints })
  } catch (error) { localError.value = error.message }
}
</script>

<template>
  <div class="registration-panel">
    <small v-if="imageWidth && imageHeight">原图尺寸：{{ imageWidth }} × {{ imageHeight }} px</small>
    <small v-else>请先导入底图</small>
    <div v-for="(row,index) in rows" :key="index" class="control-point">
      <b>控制点 {{ index + 1 }}</b>
      <div class="point-grid">
        <label>像素 X<input v-model.number="row.sx" type="number" step="0.1"></label>
        <label>像素 Y<input v-model.number="row.sy" type="number" step="0.1"></label>
        <label>地图 X<input v-model.number="row.tx" type="number" step="0.1"></label>
        <label>地图 Y<input v-model.number="row.ty" type="number" step="0.1"></label>
      </div>
      <button v-if="rows.length > 3" class="remove-point" :disabled="disabled" @click="removePoint(index)">移除</button>
    </div>
    <button class="editor-button full" :disabled="disabled" @click="addPoint">添加控制点</button>
    <button class="editor-button primary full" :disabled="disabled || rows.length < 3" @click="calculate">计算并保存配准</button>
    <p v-if="localError" class="registration-error">{{ localError }}</p>
    <div v-if="result" class="registration-result">
      <b>配准结果</b>
      <span>控制点：{{ result.controlPointCount || result.controlPoints?.length || '—' }}</span>
      <span>RMSE：{{ Number(result.rmse).toFixed(4) }}</span>
      <code v-if="result.transform">X' = {{ result.transform.a.toFixed(6) }}X + {{ result.transform.b.toFixed(6) }}Y + {{ result.transform.c.toFixed(3) }}</code>
      <code v-if="result.transform">Y' = {{ result.transform.d.toFixed(6) }}X + {{ result.transform.e.toFixed(6) }}Y + {{ result.transform.f.toFixed(3) }}</code>
    </div>
  </div>
</template>

<style scoped>
.registration-panel{display:grid;gap:8px}.registration-panel>small{color:#859189;font-size:10px}.control-point{padding:8px;border:1px solid #e4e9e4;border-radius:4px}.control-point b,.registration-result b{display:block;margin-bottom:7px;color:#536158;font-size:10px}.point-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.point-grid label{color:#7b887f;font-size:9px}.point-grid input{display:block;width:100%;min-width:0;height:27px;margin-top:3px;padding:0 5px;border:1px solid #d6ded7;border-radius:3px;font-size:10px}.remove-point{margin-top:5px;border:0;background:none;color:#a14335;font-size:10px}.registration-result{display:grid;gap:5px;padding:8px;background:#f1f5f1;color:#66736a;font-size:10px}.registration-result code{overflow-wrap:anywhere;font-size:9px}.registration-error{color:#a14335;font-size:10px;line-height:1.5}
</style>
