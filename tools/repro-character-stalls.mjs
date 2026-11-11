/**
 * 用真实 Rapier 复现用户机器上的"单步水平位移清零"停顿。
 * 参数与线上一致：胶囊 height 1.7/radius 0.55、autostep(0.45,0.275)、snap 0.25、
 * 地面静态盒顶面 y=0、固定步 60Hz、渲染 120Hz、水平速度 9m/s、着地竖直速度 -2。
 * 运行：node tools/repro-character-stalls.mjs
 */
import { PhysicsRuntime } from '../src/three/physics/PhysicsRuntime.js'

const runtime = await PhysicsRuntime.create({ fixedTimeStep: 1 / 60 })
runtime.createStaticBox({
  id: 'ground',
  translation: { x: 0, y: -0.12, z: 0 },
  halfExtents: { x: 2000, y: 0.12, z: 2000 },
  friction: 0.9,
})
runtime.createKinematicCharacter({ id: 'player', translation: { x: 0, y: 0, z: 0 } })

const stalls = []
let lastStepCount = 0
const frames = 120 * 30
for (let frame = 0; frame < frames; frame += 1) {
  runtime.step(1 / 120, {
    beforeFixedStep: () => {
      // 与 CharacterMotor.beforeFixedStep 一致：着地时 vy=-2、无加速度。
      runtime.setKinematicCharacterVelocity('player', { x: 9, y: -2, z: 0 })
      runtime.setKinematicCharacterAcceleration('player', { x: 0, y: 0, z: 0 })
    },
  })
  const state = runtime.getKinematicCharacterState('player')
  if (state.stepCount === lastStepCount) continue
  lastStepCount = state.stepCount
  const magnitude = Math.hypot(state.lastStepMovement.x, state.lastStepMovement.z)
  if (magnitude < 0.075) {
    stalls.push({
      step: state.stepCount,
      frame,
      magnitude: +magnitude.toFixed(5),
      x: +state.translation.x.toFixed(3),
      y: +state.translation.y.toFixed(4),
      grounded: state.grounded,
      contacts: state.contactCount,
      wallContacts: state.wallContactCount,
    })
  }
}
const finalState = runtime.getKinematicCharacterState('player')
console.log(JSON.stringify({
  totalSteps: runtime.stepCount,
  stallCount: stalls.length,
  firstStalls: stalls.slice(0, 15),
  finalX: finalState.translation.x,
  finalY: finalState.translation.y,
}, null, 1))
runtime.dispose()
