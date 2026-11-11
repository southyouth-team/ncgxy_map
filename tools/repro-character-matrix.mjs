/**
 * 角色控制器配置矩阵：定位平地停顿/下沉的具体开关。
 * 运行：node tools/repro-character-matrix.mjs
 */
import RAPIER from '@dimforge/rapier3d-compat'
await RAPIER.init()

function simulate({ autostep = true, snap = true, vy = -2, groundHalf = 2000, offset = 0.01, slide = true, seconds = 12 } = {}) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  world.timestep = 1 / 60
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.12, 0))
  world.createCollider(RAPIER.ColliderDesc.cuboid(groundHalf, 0.12, groundHalf).setFriction(0.9), groundBody)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0))
  const radius = 0.55
  const halfHeight = 0.3
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(0, halfHeight + radius, 0), body)
  const controller = world.createCharacterController(offset)
  controller.setUp({ x: 0, y: 1, z: 0 })
  controller.setSlideEnabled(slide)
  controller.setMaxSlopeClimbAngle(50 * Math.PI / 180)
  controller.setMinSlopeSlideAngle(30 * Math.PI / 180)
  if (autostep) controller.enableAutostep(0.45, 0.275, false)
  if (snap) controller.enableSnapToGround(0.25)

  let stalls = 0
  let minY = 0
  let maxY = 0
  const steps = seconds * 60
  for (let step = 0; step < steps; step += 1) {
    const current = body.translation()
    controller.computeColliderMovement(collider, { x: 9 / 60, y: vy / 60, z: 0 })
    const corrected = controller.computedMovement()
    const magnitude = Math.hypot(corrected.x, corrected.z)
    if (magnitude < 0.075) stalls += 1
    body.setNextKinematicTranslation({ x: current.x + corrected.x, y: current.y + corrected.y, z: current.z + corrected.z })
    world.step()
    const position = body.translation()
    minY = Math.min(minY, position.y)
    maxY = Math.max(maxY, position.y)
  }
  const final = body.translation()
  const result = {
    config: { autostep, snap, vy, groundHalf, offset, slide },
    stalls,
    steps,
    finalX: +final.x.toFixed(2),
    expectedX: +(9 * seconds).toFixed(2),
    minY: +minY.toFixed(4),
    maxY: +maxY.toFixed(4),
  }
  world.free()
  return result
}

const variants = [
  ['baseline (线上配置)', {}],
  ['no autostep', { autostep: false }],
  ['no snap', { snap: false }],
  ['no autostep + no snap', { autostep: false, snap: false }],
  ['vy=0', { vy: 0 }],
  ['small ground (54m)', { groundHalf: 27 }],
  ['offset 0.05', { offset: 0.05 }],
  ['no slide', { slide: false }],
]
for (const [name, config] of variants) {
  const result = simulate(config)
  console.log(name, JSON.stringify({ stalls: result.stalls + '/' + result.steps, finalX: result.finalX, expectedX: result.expectedX, minY: result.minY, maxY: result.maxY }))
}
