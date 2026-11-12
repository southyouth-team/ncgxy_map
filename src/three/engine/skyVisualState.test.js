import { describe, expect, it } from 'vitest'
import { getVirtualSunState } from './solarPosition.js'
import {
  getSkyVisualState,
  HORIZON_FADE_ANGLE,
  CELESTIAL_ORBIT_RADIUS,
  SUN_DISK_RADIUS,
  MOON_DISK_RADIUS,
} from './skyVisualState.js'

const makeSunState = ({ elevation, daylight, isNight, direction }) => ({
  sunElevation: elevation,
  daylight,
  isNight,
  direction,
})

const isUnit = (v) => expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6)

describe('getSkyVisualState 昼夜天体状态', () => {
  it('正午：太阳全显、月星隐藏，月亮位于地平线下', () => {
    const s = getSkyVisualState(getVirtualSunState(12))
    expect(s.sun.opacity).toBeGreaterThan(0.95)
    expect(s.moon.opacity).toBe(0)
    expect(s.starsOpacity).toBe(0)
    expect(s.moon.direction[1]).toBeLessThan(0)
    isUnit(s.sun.direction)
    isUnit(s.moon.direction)
  })

  it('午夜：月亮近天顶、星空显现、太阳隐藏', () => {
    const s = getSkyVisualState(getVirtualSunState(0))
    expect(s.moon.opacity).toBeGreaterThan(0.9)
    expect(s.starsOpacity).toBeGreaterThan(0)
    expect(s.sun.opacity).toBe(0)
    expect(s.moon.direction[1]).toBeGreaterThan(0.9)
  })

  it.each([6, 18])('小时 %s：太阳透明度在开区间，月亮贴地平线且水平方位与太阳相反', (hour) => {
    const solar = getVirtualSunState(hour)
    const s = getSkyVisualState(solar)
    expect(s.sun.opacity).toBeGreaterThan(0)
    expect(s.sun.opacity).toBeLessThan(1)
    expect(Math.abs(s.moon.direction[1])).toBeLessThan(0.05)
    expect(s.moon.direction[0]).toBeCloseTo(-s.sun.direction[0], 1)
    expect(s.moon.direction[2]).toBeCloseTo(-s.sun.direction[2], 1)
  })

  it('sun.direction 与 sunState.direction 逐分量相等', () => {
    const solar = getVirtualSunState(14)
    expect(getSkyVisualState(solar).sun.direction).toEqual(solar.direction)
  })
})

describe('getSkyVisualState 地平淡出带（地块扩建约束）', () => {
  const nightDirection = [0.9999, 0.015, 0]

  it('正午月亮在天底，opacity 严格为 0', () => {
    const s = getSkyVisualState(getVirtualSunState(12))
    expect(s.moon.direction[1]).toBeLessThan(-0.99)
    expect(s.moon.opacity).toBe(0)
  })

  it('构造仰角为负的太阳：闸门强制 opacity 为 0，即使 daylight 很高', () => {
    const below = makeSunState({
      elevation: 0.2,
      daylight: 0.8,
      isNight: false,
      direction: [0, -0.5, Math.sqrt(0.75)],
    })
    expect(getSkyVisualState(below).sun.opacity).toBe(0)
  })

  it('构造月亮在淡出带内：opacity 严格位于 (0,1) 且随仰角单调上升', () => {
    const low = makeSunState({ elevation: -0.03, daylight: 0, isNight: true, direction: nightDirection })
    const higher = makeSunState({ elevation: -0.08, daylight: 0, isNight: true, direction: nightDirection })
    const lowState = getSkyVisualState(low)
    const higherState = getSkyVisualState(higher)
    expect(lowState.moon.opacity).toBeGreaterThan(0)
    expect(lowState.moon.opacity).toBeLessThan(1)
    expect(higherState.moon.opacity).toBeGreaterThan(lowState.moon.opacity)
  })

  it('构造月亮高于淡出带：opacity 等于夜间基础值 1，不被衰减', () => {
    const high = makeSunState({ elevation: -0.5, daylight: 0, isNight: true, direction: nightDirection })
    expect(getSkyVisualState(high).moon.opacity).toBe(1)
  })

  it('全显天体几何余量：圆盘最低点离地至少一个安全边距', () => {
    for (const hour of [0, 21, 3]) {
      const s = getSkyVisualState(getVirtualSunState(hour))
      expect(s.moon.direction[1] * CELESTIAL_ORBIT_RADIUS).toBeGreaterThan(MOON_DISK_RADIUS + 8)
    }
    const day = getSkyVisualState(getVirtualSunState(12))
    expect(day.sun.direction[1] * CELESTIAL_ORBIT_RADIUS).toBeGreaterThan(SUN_DISK_RADIUS + 8)
  })

  it('HORIZON_FADE_ANGLE 为正且不超过 15 度', () => {
    expect(HORIZON_FADE_ANGLE).toBeGreaterThan(0)
    expect(HORIZON_FADE_ANGLE).toBeLessThan(15 * Math.PI / 180)
  })
})

describe('getSkyVisualState 雨天、颜色与容错', () => {
  it.each([0, 12, 18])('雨天小时 %s：日月星 opacity 全为 0', (hour) => {
    const s = getSkyVisualState(getVirtualSunState(hour), 'rain')
    expect(s.sun.opacity).toBe(0)
    expect(s.moon.opacity).toBe(0)
    expect(s.starsOpacity).toBe(0)
  })

  it('雨天天空色比晴天偏灰（通道极差更小）且两色不同', () => {
    const solar = getVirtualSunState(14)
    const clear = getSkyVisualState(solar, 'clear')
    const rain = getSkyVisualState(solar, 'rain')
    expect(rain.skyHorizon).not.toEqual(clear.skyHorizon)
    const spread = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
    expect(spread(rain.skyHorizon)).toBeLessThan(spread(clear.skyHorizon))
  })

  it.each([0, 6, 12, 18, 22])('小时 %s：颜色分量都是 [0,1] 有限数，天顶亮度低于地平线', (hour) => {
    const s = getSkyVisualState(getVirtualSunState(hour))
    for (const c of [s.skyTop, s.skyHorizon]) {
      for (const k of ['r', 'g', 'b']) {
        expect(Number.isFinite(c[k])).toBe(true)
        expect(c[k]).toBeGreaterThanOrEqual(0)
        expect(c[k]).toBeLessThanOrEqual(1)
      }
    }
    const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    expect(luminance(s.skyTop)).toBeLessThan(luminance(s.skyHorizon))
  })

  it('注入 horizonColor 时 skyHorizon 与其同值', () => {
    const s = getSkyVisualState(getVirtualSunState(12), 'clear', { r: 0.2, g: 0.4, b: 0.6 })
    expect(s.skyHorizon).toEqual({ r: 0.2, g: 0.4, b: 0.6 })
  })

  it('非法 weather 按 clear 归一化；非法 sunState 不产生 NaN', () => {
    const solar = getVirtualSunState(12)
    expect(getSkyVisualState(solar, 'snow')).toEqual(getSkyVisualState(solar, 'clear'))
    const broken = getSkyVisualState({
      sunElevation: Number.NaN,
      daylight: Number.NaN,
      isNight: false,
      direction: [Number.NaN, Number.NaN, Number.NaN],
    })
    const numbers = [
      ...broken.sun.direction,
      ...broken.moon.direction,
      broken.sun.opacity,
      broken.moon.opacity,
      broken.starsOpacity,
      broken.skyTop.r,
      broken.skyHorizon.b,
    ]
    expect(numbers.every(Number.isFinite)).toBe(true)
  })

  it('同输入两次调用结果深相等（确定性）', () => {
    const solar = getVirtualSunState(17.5)
    const a = getSkyVisualState(solar, 'rain', { r: 0.1, g: 0.2, b: 0.3 })
    const b = getSkyVisualState(solar, 'rain', { r: 0.1, g: 0.2, b: 0.3 })
    expect(a).toEqual(b)
  })
})
