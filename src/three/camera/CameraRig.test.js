import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CameraRig } from './CameraRig.js'

// rotateFirst/rotateThird 是纯姿态数值方法，不依赖 DOM；
// 用原型对象绕过需要 domElement/OrbitControls 的构造函数，只装配它们读取的字段。
function createBareRig() {
  const rig = Object.create(CameraRig.prototype)
  rig.firstYaw = 0
  rig.firstPitch = -0.12
  rig.thirdYaw = 0.35
  rig.thirdPitch = 0.32
  rig.thirdDistance = 15
  rig.viewMode = '3d'
  rig.player = new THREE.Vector3(0, 1.7, 24)
  rig.desiredPosition = new THREE.Vector3()
  rig.desiredTarget = new THREE.Vector3()
  return rig
}

describe('CameraRig 俯仰限制', () => {
  it('第一人称持续抬头可接近天顶（大于 80° 且不越过 90°）', () => {
    const rig = createBareRig()
    for (let i = 0; i < 3000; i += 1) rig.rotateFirst(0, -1)
    expect(rig.firstPitch).toBeGreaterThan(80 * Math.PI / 180)
    expect(rig.firstPitch).toBeLessThan(Math.PI / 2)
  })

  it('第一人称俯视下限保持 -1.25 rad 不变', () => {
    const rig = createBareRig()
    for (let i = 0; i < 3000; i += 1) rig.rotateFirst(0, 1)
    expect(rig.firstPitch).toBeCloseTo(-1.25, 6)
  })

  it('第三人称仰视钳制在 -0.05 rad，防止相机绕玩家沉到地面以下', () => {
    const rig = createBareRig()
    for (let i = 0; i < 3000; i += 1) rig.rotateThird(0, -1)
    expect(rig.thirdPitch).toBeCloseTo(-0.05, 6)
  })

  it('最大仰视配合最远相机距离，相机世界高度仍在地面（y=0）以上', () => {
    const rig = createBareRig()
    rig.thirdDistance = 32
    for (let i = 0; i < 3000; i += 1) rig.rotateThird(0, -1)
    rig.updateThirdPersonDesired()
    expect(rig.desiredPosition.y).toBeGreaterThan(0)
  })
})
