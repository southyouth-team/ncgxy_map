/**
 * 地面尺寸/形态扫描：找出角色控制器粘滞的几何条件。
 * 运行：node tools/repro-ground-size-sweep.mjs
 */
import RAPIER from '@dimforge/rapier3d-compat'
await RAPIER.init()

function makeCharacter(world, offset = 0.01) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0))
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.3, 0.55).setTranslation(0, 0.85, 0), body)
  const controller = world.createCharacterController(offset)
  controller.setUp({ x: 0, y: 1, z: 0 })
  controller.setSlideEnabled(true)
  controller.setMaxSlopeClimbAngle(50 * Math.PI / 180)
  controller.setMinSlopeSlideAngle(30 * Math.PI / 180)
  controller.enableAutostep(0.45, 0.275, false)
  controller.enableSnapToGround(0.25)
  return { body, collider, controller }
}

function run(world, character, seconds) {
  const { body, collider, controller } = character
  let stalls = 0
  let groundedSteps = 0
  let minY = 0
  const steps = Math.floor(seconds * 60)
  const stallPositions = []
  for (let step = 0; step < steps; step += 1) {
    const current = body.translation()
    controller.computeColliderMovement(collider, { x: 9 / 60, y: -2 / 60, z: 0 })
    const corrected = controller.computedMovement()
    if (current.y > -0.5) {
      groundedSteps += 1
      if (Math.hypot(corrected.x, corrected.z) < 0.075) {
        stalls += 1
        if (stallPositions.length < 8) stallPositions.push(+current.x.toFixed(2))
      }
    }
    body.setNextKinematicTranslation({ x: current.x + corrected.x, y: current.y + corrected.y, z: current.z + corrected.z })
    world.step()
    minY = Math.min(minY, body.translation().y)
  }
  return { stalls, groundedSteps, finalX: +body.translation().x.toFixed(2), minY: +minY.toFixed(3), stallPositions }
}

function boxGround(half) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  world.timestep = 1 / 60
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.12, 0))
  world.createCollider(RAPIER.ColliderDesc.cuboid(half, 0.12, half).setFriction(0.9), groundBody)
  return world
}

console.log('--- 单块方形地面尺寸扫描（vy=-2，12 秒或走到边缘前）---')
for (const half of [13.5, 27, 50, 100, 200, 500, 1000, 2000]) {
  const world = boxGround(half)
  const character = makeCharacter(world)
  const seconds = Math.min(12, Math.max(1, (half - 8) / 9))
  const result = run(world, character, seconds)
  console.log(`half=${half}`, JSON.stringify(result))
  world.free()
}

console.log('--- 两块相邻地块（54m 接缝）---')
{
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  world.timestep = 1 / 60
  for (const cx of [0, 54]) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, -0.12, 0))
    world.createCollider(RAPIER.ColliderDesc.cuboid(27, 0.12, 27).setFriction(0.9), body)
  }
  const character = makeCharacter(world)
  const result = run(world, character, 8)
  console.log('two-chunk-seam', JSON.stringify(result))
  world.free()
}

console.log('--- 平板 trimesh 地面（不同网格密度，108m 宽）---')
for (const segments of [1, 4, 12, 24]) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  world.timestep = 1 / 60
  const size = 216
  const vertices = []
  const indices = []
  for (let iz = 0; iz <= segments; iz += 1) {
    for (let ix = 0; ix <= segments; ix += 1) {
      vertices.push((ix / segments - 0.5) * size, 0, (iz / segments - 0.5) * size)
    }
  }
  for (let iz = 0; iz < segments; iz += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const a = iz * (segments + 1) + ix
      const b = a + 1
      const c = a + segments + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)).setFriction(0.9), body)
  const character = makeCharacter(world)
  const result = run(world, character, 10)
  console.log(`trimesh segments=${segments} (cell ${(size / segments).toFixed(1)}m)`, JSON.stringify(result))
  world.free()
}
