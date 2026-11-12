import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createSkyRuntime } from './skyRuntime.js'
import { getVirtualSunState } from './solarPosition.js'
import { getSkyVisualState, CELESTIAL_ORBIT_RADIUS, STAR_COUNT } from './skyVisualState.js'

function findByName(root, name) {
  let found = null
  root.traverse((object) => {
    if (object.name === name) found = object
  })
  return found
}

describe('createSkyRuntime 工厂结构与生命周期', () => {
  it('创建穹顶/太阳/月亮/星空四个命名成员，穹顶为 BackSide 且不写深度', () => {
    const runtime = createSkyRuntime(THREE)
    expect(runtime.group).toBeInstanceOf(THREE.Group)
    const dome = findByName(runtime.group, 'sky-dome')
    expect(dome).toBeTruthy()
    expect(dome.material.side).toBe(THREE.BackSide)
    expect(dome.material.depthWrite).toBe(false)
    expect(dome.frustumCulled).toBe(false)
    expect(findByName(runtime.group, 'sky-sun')).toBeTruthy()
    expect(findByName(runtime.group, 'sky-moon')).toBeTruthy()
    expect(findByName(runtime.group, 'sky-stars')).toBeTruthy()
  })

  it('日月为带辉光的 ShaderMaterial：太阳加性混合、月亮普通透明混合，均不写深度且不受雾影响', () => {
    const runtime = createSkyRuntime(THREE)
    const sun = findByName(runtime.group, 'sky-sun')
    const moon = findByName(runtime.group, 'sky-moon')
    expect(sun.material.isShaderMaterial).toBe(true)
    expect(moon.material.isShaderMaterial).toBe(true)
    expect(sun.material.blending).toBe(THREE.AdditiveBlending)
    expect(moon.material.blending).toBe(THREE.NormalBlending)
    expect(sun.material.transparent).toBe(true)
    expect(sun.material.depthWrite).toBe(false)
    expect(moon.material.depthWrite).toBe(false)
    expect(sun.material.fog).toBe(false)
    expect(moon.material.fog).toBe(false)
    expect(sun.material.uniforms.uOpacity).toBeTruthy()
    expect(moon.material.uniforms.uOpacity).toBeTruthy()
  })

  it('update 后太阳位置沿方向放到轨道半径、透明度写入 uOpacity 且不投影', () => {
    const runtime = createSkyRuntime(THREE)
    const state = getSkyVisualState(getVirtualSunState(12))
    runtime.update(state)
    const sun = findByName(runtime.group, 'sky-sun')
    const expected = new THREE.Vector3(...state.sun.direction).multiplyScalar(CELESTIAL_ORBIT_RADIUS)
    expect(sun.position.distanceTo(expected)).toBeLessThan(1e-4)
    expect(sun.material.uniforms.uOpacity.value).toBeCloseTo(state.sun.opacity, 6)
    expect(sun.castShadow).toBe(false)
  })

  it('followCamera 三轴复制相机位置；setIndoor 切换 visible', () => {
    const runtime = createSkyRuntime(THREE)
    runtime.followCamera(new THREE.Vector3(12, 88, -5))
    expect(runtime.group.position.toArray()).toEqual([12, 88, -5])
    runtime.setIndoor(true)
    expect(runtime.group.visible).toBe(false)
    runtime.setIndoor(false)
    expect(runtime.group.visible).toBe(true)
  })

  it('dispose 释放资源且重复调用不抛', () => {
    const runtime = createSkyRuntime(THREE)
    expect(() => runtime.dispose()).not.toThrow()
    expect(() => runtime.dispose()).not.toThrow()
  })

  it('星空星数等于 STAR_COUNT 且只分布在上半天球', () => {
    const runtime = createSkyRuntime(THREE)
    const stars = findByName(runtime.group, 'sky-stars')
    expect(stars.geometry.attributes.position.count).toBe(STAR_COUNT)
    const positions = stars.geometry.attributes.position.array
    for (let i = 1; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThan(0)
    }
  })
})
