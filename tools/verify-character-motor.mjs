/**
 * 真实 CharacterMotor + PhysicsRuntime + Rapier 的着地竖直速度修复验证。
 * 覆盖平地/接缝/trimesh、台阶、坡面、悬崖、撞墙、跳跃与落地。
 * 运行：node tools/verify-character-motor.mjs
 */
import { CharacterMotor } from '../src/three/controls/CharacterMotor.js'
import { PhysicsRuntime } from '../src/three/physics/PhysicsRuntime.js'
import { DEFAULT_CHARACTER_TRAVERSAL_PROFILE } from '../src/three/physics/CharacterTraversalProfile.js'

const SPEED = 9
const failures = []

function addGround(runtime, half = 100) {
  runtime.createStaticBox({
    id: 'ground',
    translation: { x: 0, y: -0.12, z: 0 },
    halfExtents: { x: half, y: 0.12, z: Math.min(half, 30) },
    friction: 0.9,
  })
}

function addFlatTrimesh(runtime) {
  const segments = 24
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
  runtime.createStaticTrimesh({ id: 'ground', vertices, indices, friction: 0.9 })
}

function movementMagnitude(sample) {
  return Math.hypot(sample.movement.x, sample.movement.z)
}

function maxLowMovementRun(samples, predicate = () => true) {
  let current = 0
  let maximum = 0
  for (const sample of samples) {
    if (predicate(sample) && movementMagnitude(sample) < 0.075) {
      current += 1
      maximum = Math.max(maximum, current)
    } else {
      current = 0
    }
  }
  return maximum
}

async function simulate(name, {
  setup,
  start = { x: 0, y: 0, z: 0 },
  seconds,
  onFrame,
  evaluate,
}) {
  const runtime = await PhysicsRuntime.create({ fixedTimeStep: 1 / 60 })
  const traversalProfile = DEFAULT_CHARACTER_TRAVERSAL_PROFILE
  setup(runtime)
  runtime.createKinematicCharacter({ id: 'player', translation: start, traversalProfile })
  const motor = new CharacterMotor({ traversalProfile })
  motor.setPhysicsRuntime(runtime, 'player')
  const samples = []

  // Let Rapier populate its initial contact state before measuring sustained walking.
  for (let frame = 0; frame < 30; frame += 1) {
    runtime.step(1 / 120, {
      beforeFixedStep(event) {
        motor.horizontalVelocity = { x: 0, z: 0 }
        motor.beforeFixedStep(event)
      },
      afterFixedStep: () => motor.afterFixedStep(),
    })
  }
  const measurementStart = { ...runtime.getKinematicCharacterState('player').translation }

  for (let frame = 0; frame < seconds * 120; frame += 1) {
    onFrame?.({ time: frame / 120, motor, runtime })
    runtime.step(1 / 120, {
      beforeFixedStep(event) {
        motor.horizontalVelocity = { x: SPEED, z: 0 }
        motor.beforeFixedStep(event)
      },
      afterFixedStep() {
        motor.afterFixedStep()
        const state = runtime.getKinematicCharacterState('player')
        samples.push({
          position: state.translation,
          movement: state.lastStepMovement,
          verticalVelocity: motor.verticalVelocity,
          grounded: state.grounded,
          wallContacts: state.wallContactCount,
          jumpActive: motor.jumpActive,
        })
      },
    })
  }

  const final = samples.at(-1)
  const metrics = {
    steps: samples.length,
    finalX: +final.position.x.toFixed(4),
    finalY: +final.position.y.toFixed(4),
    minY: +Math.min(...samples.map(sample => sample.position.y)).toFixed(4),
    maxY: +Math.max(...samples.map(sample => sample.position.y)).toFixed(4),
    groundedSteps: samples.filter(sample => sample.grounded).length,
    lowMovementSteps: samples.filter(sample => movementMagnitude(sample) < 0.075).length,
    maxLowMovementRun: maxLowMovementRun(samples),
    wallContactSteps: samples.filter(sample => sample.wallContacts > 0).length,
    finalVerticalVelocity: +final.verticalVelocity.toFixed(4),
    finalGrounded: final.grounded,
    finalJumpActive: final.jumpActive,
  }
  const checks = evaluate({ samples, final, metrics, start: measurementStart })
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([check]) => check)
  if (failedChecks.length) failures.push({ scenario: name, failedChecks })
  console.log(JSON.stringify({ scenario: name, metrics, checks, failedChecks }))
  runtime.dispose()
}

const flatChecks = ({ samples, final, start }) => ({
  zeroGroundedStalls: samples.filter(sample => sample.grounded && movementMagnitude(sample) < 0.075).length === 0,
  travelLossBelowOneFixedStep: Math.abs(final.position.x - (start.x + SPEED * samples.length / 60)) < SPEED / 60,
  stableGrounded: samples.every(sample => sample.grounded),
  noSinkingOrFloating: samples.every(sample => Math.abs(sample.position.y) < 0.05),
})

await simulate('flat-production-chunks-30s', {
  setup(runtime) {
    // Match the sandbox: separate 54 × 42 m cuboids with shared seams.
    for (const chunkX of [-3, -2, -1, 0, 1, 2, 3]) {
      runtime.createStaticBox({
        id: `ground-${chunkX}`,
        translation: { x: chunkX * 54, y: -0.12, z: 0 },
        halfExtents: { x: 27, y: 0.12, z: 21 },
        friction: 0.9,
      })
    }
  },
  start: { x: -150, y: 0, z: 0 },
  seconds: 30,
  evaluate: flatChecks,
})

await simulate('flat-adjacent-chunk-seam', {
  setup(runtime) {
    for (const [index, x] of [0, 54].entries()) {
      runtime.createStaticBox({
        id: `ground-${index}`,
        translation: { x, y: -0.12, z: 0 },
        halfExtents: { x: 27, y: 0.12, z: 27 },
        friction: 0.9,
      })
    }
  },
  start: { x: -20, y: 0, z: 0 },
  seconds: 8,
  evaluate: flatChecks,
})

await simulate('flat-trimesh-12s', {
  setup: addFlatTrimesh,
  start: { x: -50, y: 0, z: 0 },
  seconds: 12,
  evaluate: flatChecks,
})

await simulate('walk-off-ledge', {
  setup: runtime => addGround(runtime, 3),
  seconds: 1.5,
  evaluate: ({ samples, final }) => ({
    becameAirborne: samples.some(sample => !sample.grounded),
    fellUnderGravity: final.position.y < -1 && final.verticalVelocity < -5,
    remainsAirborne: !final.grounded,
  }),
})

for (const height of [0.2, 0.45]) {
  await simulate(`autostep-${height.toFixed(2)}m`, {
    setup(runtime) {
      addGround(runtime, 50)
      runtime.createStaticBox({
        id: 'platform',
        translation: { x: 16, y: (height - 0.24) / 2, z: 0 },
        halfExtents: { x: 14, y: (height + 0.24) / 2, z: 5 },
        friction: 0.9,
      })
    },
    start: { x: -3, y: 0, z: 0 },
    seconds: 2,
    evaluate: ({ samples, final }) => ({
      crossedStep: final.position.x > 14,
      standingAtPlatformHeight: Math.abs(final.position.y - height) < 0.06,
      noProlongedBlockage: maxLowMovementRun(samples) < 10,
      groundedAtEnd: final.grounded,
    }),
  })
}

await simulate('walk-up-20-degree-ramp', {
  setup(runtime) {
    addGround(runtime, 50)
    const length = 16
    const height = Math.tan(20 * Math.PI / 180) * length
    runtime.createStaticTrimesh({
      id: 'ramp',
      vertices: [
        0, 0, -3,
        0, 0, 3,
        length, height, 3,
        length, height, -3,
      ],
      indices: [0, 1, 2, 0, 2, 3],
      friction: 0.9,
    })
  },
  start: { x: -4, y: 0, z: 0 },
  seconds: 1.8,
  evaluate: ({ samples, final }) => ({
    climbedRamp: final.position.x > 10 && final.position.y > 3.5,
    stayedOnRampSurface: Math.abs(final.position.y - final.position.x * Math.tan(20 * Math.PI / 180)) < 0.25,
    noProlongedBlockage: maxLowMovementRun(samples) < 10,
    groundedAtEnd: final.grounded,
  }),
})

await simulate('blocking-wall', {
  setup(runtime) {
    addGround(runtime, 50)
    runtime.createStaticBox({
      id: 'wall',
      translation: { x: 5, y: 1, z: 0 },
      halfExtents: { x: 0.2, y: 1, z: 3 },
      friction: 0.9,
    })
  },
  seconds: 1.5,
  evaluate: ({ samples, final }) => ({
    didNotPassThroughWall: final.position.x < 4.5,
    reportedWallContacts: samples.some(sample => sample.wallContacts > 0),
    stayedGrounded: final.grounded,
  }),
})

await simulate('jump-and-land', {
  setup: runtime => addGround(runtime),
  start: { x: -10, y: 0, z: 0 },
  seconds: 2.5,
  onFrame({ time, motor }) {
    if (time >= 0.25 && !motor.jumpRequested && !motor.jumpActive && !motor.jumpLaunched && time < 0.3) {
      motor.jumpPlayer()
    }
  },
  evaluate: ({ samples, final, metrics }) => ({
    becameAirborne: samples.some(sample => !sample.grounded),
    reachedJumpHeight: metrics.maxY >= DEFAULT_CHARACTER_TRAVERSAL_PROFILE.jumpHeight * 0.8,
    landed: final.grounded && !final.jumpActive && Math.abs(final.position.y) < 0.05,
    noGroundedStallsOutsideJump: samples.filter(sample => (
      sample.grounded && !sample.jumpActive && movementMagnitude(sample) < 0.075
    )).length === 0,
  }),
})

if (failures.length) {
  console.error(JSON.stringify({ result: 'FAILED', failures }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ result: 'PASS', scenarios: 9 }))
}
