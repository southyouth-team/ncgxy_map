import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createRainFieldRuntime, RAIN_PARTICLE_COUNT, RAIN_FIELD_HALF_SPAN } from './rainFieldRuntime.js'

describe('createRainFieldRuntime 雨场', () => {
  it('创建 360 条线段的 LineSegments，默认不可见且不参与视锥剔除', () => {
    const rain = createRainFieldRuntime(THREE)
    expect(rain.object).toBeInstanceOf(THREE.LineSegments)
    expect(rain.object.name).toBe('world-rain-effect')
    expect(rain.object.visible).toBe(false)
    expect(rain.object.frustumCulled).toBe(false)
    expect(rain.object.geometry.attributes.position.count).toBe(RAIN_PARTICLE_COUNT * 2)
  })

  it('初始粒子本地坐标全部落在雨场盒子内', () => {
    const rain = createRainFieldRuntime(THREE)
    const positions = rain.object.geometry.attributes.position.array
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThanOrEqual(-RAIN_FIELD_HALF_SPAN - 0.1)
      expect(positions[i]).toBeLessThanOrEqual(RAIN_FIELD_HALF_SPAN + 0.1)
      expect(positions[i + 2]).toBeGreaterThanOrEqual(-RAIN_FIELD_HALF_SPAN - 0.1)
      expect(positions[i + 2]).toBeLessThanOrEqual(RAIN_FIELD_HALF_SPAN + 0.1)
      // 线段下端比起点低 0.48（雨丝长度），允许略低于地面平面。
      expect(positions[i + 1]).toBeGreaterThanOrEqual(-0.5)
      expect(positions[i + 1]).toBeLessThan(30)
    }
  })

  it('followCamera 只复制 X/Z，雨层高度始终贴地（y 恒为 0）', () => {
    const rain = createRainFieldRuntime(THREE)
    rain.followCamera(new THREE.Vector3(120, 145, -88))
    expect(rain.object.position.x).toBe(120)
    expect(rain.object.position.z).toBe(-88)
    expect(rain.object.position.y).toBe(0)
  })

  it('无风长时间模拟后粒子仍在本地盒子内循环且标记缓冲需要上传', () => {
    const rain = createRainFieldRuntime(THREE)
    rain.setVisible(true)
    for (let frame = 0; frame < 600; frame += 1) rain.update(1 / 60, 0)
    const positions = rain.object.geometry.attributes.position.array
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThanOrEqual(-RAIN_FIELD_HALF_SPAN - 0.1)
      expect(positions[i]).toBeLessThanOrEqual(RAIN_FIELD_HALF_SPAN + 0.1)
      expect(positions[i + 2]).toBeGreaterThanOrEqual(-RAIN_FIELD_HALF_SPAN - 0.1)
      expect(positions[i + 2]).toBeLessThanOrEqual(RAIN_FIELD_HALF_SPAN + 0.1)
      expect(positions[i + 1]).toBeGreaterThanOrEqual(-0.5)
      expect(positions[i + 1]).toBeLessThan(30)
    }
    // three 的 needsUpdate 是只写 setter（写入即递增 version），断言 version 已递增。
    expect(rain.object.geometry.attributes.position.version).toBeGreaterThan(0)
  })

  it('风把雨丝沿水平方向吹偏', () => {
    const rain = createRainFieldRuntime(THREE)
    rain.setVisible(true)
    const before = Float32Array.from(rain.object.geometry.attributes.position.array)
    for (let frame = 0; frame < 30; frame += 1) rain.update(1 / 60, 1)
    const after = rain.object.geometry.attributes.position.array
    // 粒子 11 初始 y=23，0.5 秒下落 9 单位不会触发落地重置，其 x 增量应等于 wind*3.2*0.5。
    const offset = 11 * 6
    expect(after[offset] - before[offset]).toBeCloseTo(3.2 * 0.5, 5)
  })

  it('不可见时 update 不推进粒子（保留总览按需渲染的早退语义）', () => {
    const rain = createRainFieldRuntime(THREE)
    const before = Float32Array.from(rain.object.geometry.attributes.position.array)
    rain.update(0.1, 1)
    expect(Array.from(rain.object.geometry.attributes.position.array)).toEqual(Array.from(before))
  })

  it('setVisible/visible 切换；dispose 幂等不抛', () => {
    const rain = createRainFieldRuntime(THREE)
    rain.setVisible(true)
    expect(rain.visible).toBe(true)
    expect(rain.object.visible).toBe(true)
    rain.setVisible(false)
    expect(rain.visible).toBe(false)
    expect(() => rain.dispose()).not.toThrow()
    expect(() => rain.dispose()).not.toThrow()
  })
})
