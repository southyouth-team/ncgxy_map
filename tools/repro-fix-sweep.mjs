/**
 * 停顿修复参数扫描：在多种地面形态上验证 vy/offset/autostep/snap 组合。
 * 运行：node tools/repro-fix-sweep.mjs
 */
import RAPIER from '@dimforge/rapier3d-compat'
await RAPIER.init()

function buildWorld(kind) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  world.timestep = 1 / 60
  if (kind === 'chunk27' || kind === 'chunk13') {
    const half = kind === 'chunk27' ? 27 : 13.5
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.12, 0))
    world.createCollider(RAPIER.ColliderDesc.cuboid(half, 0.12, half).setFriction(0.9), body)
  } else if (kind === 'seam') {
    for (const cx of [0, 54]) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, -0.12, 0))
      world.createCollider(RAPIER.ColliderDesc.cuboid(27, 0.12, 27).setFriction(0.9), body)
    }
  } else if (kind === 'trimesh') {
    const segments = 24
    const size = 216
    const vertices = []
    const indices = []
    for (let iz = 0; iz <= segments; iz += 1) {
      for (let ix = 0; ix <= segments; ix += 1) vertices.push((ix / segments - 0.5) * size, 0, (iz / segments - 0.5) * size)
    }
    for (let iz = 0; iz < segments; iz += 1) {
      for (let ix = 0; ix < segments; ix += 1) {
        const a = iz * (segments + 1) + ix
        indices.push(a, a + segments + 1, a + 1, a + 1, a + segments + 1, a + segments + 2)
      }
    }
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)).setFriction(0.9), body)
  }
  return world
}

function simulate(world, { vy = -2, offset = 0.01, autostep = true, snap = 0.25, seconds = 8 }) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0))
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.3, 0.55).setTranslation(0, 0.85, 0), body)
  const controller = world.createCharacterController(offset)
  controller.setUp({ x: 0, y: 1, z: 0 })
  controller.setSlideEnabled(true)
  controller.setMaxSlopeClimbAngle(50 * Math.PI / 180)
  controller.setMinSlopeSlideAngle(30 * Math.PI / 180)
  if (autostep) controller.enableAutostep(0.45, 0.275, false)
  if (snap > 0) controller.enableSnapToGround(snap)
  let stalls = 0
  let groundedSteps = 0
  for (let step = 0; step < seconds * 60; step += 1) {
    const current = body.translation()
    if (current.y < -0.5) break
    groundedSteps += 1
    controller.computeColliderMovement(collider, { x: 9 / 60, y: vy / 60, z: 0 })
    const corrected = controller.computedMovement()
    if (Math.hypot(corrected.x, corrected.z) < 0.075) stalls += 1
    body.setNextKinematicTranslation({ x: current.x + corrected.x, y: current.y + corrected.y, z: current.z + corrected.z })
    world.step()
  }
  return { stalls, groundedSteps, finalX: +body.translation().x.toFixed(2) }
}

const variants = [
  ['baseline vy=-2', {}],
  ['vy=-0.25', { vy: -0.25 }],
  ['vy=0', { vy: 0 }],
  ['offset=0.05', { offset: 0.05 }],
  ['offset=0.1', { offset: 0.1 }],
  ['no-autostep', { autostep: false }],
  ['no-autostep vy=-0.25', { autostep: false, vy: -0.25 }],
  ['no-snap', { snap: 0 }],
  ['offset=0.05 vy=-0.25', { offset: 0.05, vy: -0.25 }],
]
for (const kind of ['chunk27', 'chunk13', 'seam', 'trimesh']) {
  console.log('=== ground:', kind)
  for (const [name, config] of variants) {
    const world = buildWorld(kind)
    const result = simulate(world, config)
    console.log(' ', name.padEnd(26), JSON.stringify(result))
    world.free()
  }
}
