// 天空视觉状态纯函数层：把虚拟太阳状态 + 天气映射为穹顶/日月/星空的视觉参数。
// 本模块禁止依赖 three，所有输出都是普通数值/数组，便于完整单测与离线复用。

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const clamp01 = (value) => clamp(value, 0, 1)

const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

const normalize3 = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

// 装配尺寸常量：skyRuntime 与测试共享同一份，禁止在别处复制魔法数。
export const HORIZON_FADE_ANGLE = Math.PI / 30 // 6° 地平淡出带
export const SKY_DOME_RADIUS = 400
export const CELESTIAL_ORBIT_RADIUS = SKY_DOME_RADIUS * 0.92
export const SUN_DISK_RADIUS = 14
export const MOON_DISK_RADIUS = 10
export const STAR_COUNT = 600
export const STAR_SHELL_RADIUS = 380

// 与 createCampusEngine.setEnvironment 的背景调色板保持同色系（未注入 horizonColor 时的兜底派生）。
const PALETTE = {
  nightSky: { r: 0x11 / 255, g: 0x1d / 255, b: 0x31 / 255 },
  dawnSky: { r: 0xe4 / 255, g: 0xa7 / 255, b: 0x7e / 255 },
  daySky: { r: 0xb9 / 255, g: 0xd0 / 255, b: 0xc2 / 255 },
  rainGray: { r: 0x78 / 255, g: 0x88 / 255, b: 0x94 / 255 },
}

const mixColor = (a, b, t) => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
})

// 天顶色：地平线色逐通道压暗，蓝通道保留最多，保证天顶偏蓝且亮度严格更低。
const deriveTopColor = (horizon) => ({
  r: clamp01(horizon.r * 0.45),
  g: clamp01(horizon.g * 0.55),
  b: clamp01(horizon.b * 0.75),
})

function normalizeSunState(input) {
  const elevation = Number.isFinite(input?.sunElevation) ? clamp(input.sunElevation, -1, 1) : 0
  const daylight = Number.isFinite(input?.daylight) ? clamp01(input.daylight) : 0
  const isNight = Boolean(input?.isNight)
  const raw = Array.isArray(input?.direction) ? input.direction : []
  const direction = [0, 1, 2].every((i) => Number.isFinite(raw[i])) ? [raw[0], raw[1], raw[2]] : [0, 1, 0]
  return { sunElevation: elevation, daylight, isNight, direction }
}

/**
 * 独立月亮弧（与夜间灯光方向解耦）：
 * 午夜太阳在天底（elevation=-1）时月亮升至天顶，正午月亮在天底；
 * 水平方位恒与太阳相反。夜间 solarPosition 已把灯光方向翻转过 x/z，故 isNight 时取正。
 */
function moonDirection(sunState) {
  const moonElevation = -Math.asin(clamp(sunState.sunElevation, -1, 1))
  const sx = sunState.direction[0]
  const sz = sunState.direction[2]
  const horizontalLength = Math.hypot(sx, sz)
  let mx = 0
  let mz = 0
  if (horizontalLength > 1e-6) {
    const flip = sunState.isNight ? 1 : -1
    mx = (sx / horizontalLength) * flip
    mz = (sz / horizontalLength) * flip
  }
  const cosine = Math.cos(moonElevation)
  return normalize3([mx * cosine, Math.sin(moonElevation), mz * cosine])
}

function baseSunOpacity(sunState) {
  return sunState.isNight ? 0 : clamp01(sunState.daylight)
}

function baseNightOpacity(sunState) {
  return clamp01(1 - clamp01(sunState.daylight))
}

/**
 * 地平淡出带：仰角 ≤0 强制不可见，淡出角内平滑衰减，之上不衰减。
 * 保证天体在触地前消失，数学上杜绝与地块/地面穿插。
 */
function applyHorizonFade(direction, baseOpacity) {
  if (baseOpacity <= 0) return 0
  const elevation = Math.asin(clamp(direction[1], -1, 1))
  if (elevation <= 0) return 0
  if (elevation >= HORIZON_FADE_ANGLE) return baseOpacity
  return baseOpacity * smoothstep(0, HORIZON_FADE_ANGLE, elevation)
}

function deriveHorizonColor(sunState, rainy) {
  const horizon = sunState.isNight
    ? { ...PALETTE.nightSky }
    : mixColor(PALETTE.dawnSky, PALETTE.daySky, clamp01(sunState.daylight))
  return rainy ? mixColor(horizon, PALETTE.rainGray, 0.55) : horizon
}

export function getSkyVisualState(sunStateInput, weather = 'clear', horizonColor = null) {
  const sunState = normalizeSunState(sunStateInput)
  const rainy = weather === 'rain'
  const sunDirection = [...sunState.direction]
  const moonDir = moonDirection(sunState)
  const nightAmount = baseNightOpacity(sunState)

  // 引擎注入同值背景色时以注入为准（接缝构造性消除）；未注入才走内置调色板。
  const skyHorizon = horizonColor
    ? {
      r: clamp01(Number(horizonColor.r) || 0),
      g: clamp01(Number(horizonColor.g) || 0),
      b: clamp01(Number(horizonColor.b) || 0),
    }
    : deriveHorizonColor(sunState, rainy)

  return {
    sun: {
      direction: sunDirection,
      opacity: rainy ? 0 : applyHorizonFade(sunDirection, baseSunOpacity(sunState)),
    },
    moon: {
      direction: moonDir,
      opacity: rainy ? 0 : applyHorizonFade(moonDir, nightAmount),
    },
    // 星空是整个上半球壳层、无单一方向，只随昼夜/天气淡变，不套仰角闸门。
    starsOpacity: rainy ? 0 : nightAmount * 0.85,
    skyTop: deriveTopColor(skyHorizon),
    skyHorizon,
  }
}
