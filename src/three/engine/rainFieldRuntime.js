// 雨场粒子系统：粒子在固定本地盒子内循环下落，整个雨场跟随相机 X/Z 移动，
// 玩家在沙盒（含扩建后的任意地块）中始终处于雨区覆盖之内。
export const RAIN_PARTICLE_COUNT = 360
export const RAIN_FIELD_HALF_SPAN = 30

const RAIN_FALL_SPEED = 18
const RAIN_INITIAL_TOP = 24
const RAIN_RESET_BASE_Y = 18

export function createRainFieldRuntime(THREE) {
  const positions = new Float32Array(RAIN_PARTICLE_COUNT * 6)
  for (let index = 0; index < RAIN_PARTICLE_COUNT; index += 1) {
    const offset = index * 6
    const x = ((index * 17) % 61) - RAIN_FIELD_HALF_SPAN
    const y = (index * 13) % RAIN_INITIAL_TOP
    const z = ((index * 29) % 61) - RAIN_FIELD_HALF_SPAN
    positions[offset] = x
    positions[offset + 1] = y
    positions[offset + 2] = z
    positions[offset + 3] = x + 0.02
    positions[offset + 4] = y - 0.48
    positions[offset + 5] = z + 0.01
  }
  const geometry = new THREE.BufferGeometry()
  const attribute = new THREE.BufferAttribute(positions, 3)
  attribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', attribute)
  const material = new THREE.LineBasicMaterial({ color: '#d8e8f5', transparent: true, opacity: 0.58 })
  const object = new THREE.LineSegments(geometry, material)
  object.name = 'world-rain-effect'
  object.frustumCulled = false
  object.visible = false

  function update(delta, wind) {
    if (!object.visible) return
    const windValue = Number(wind) || 0
    for (let index = 0; index < RAIN_PARTICLE_COUNT; index += 1) {
      const offset = index * 6
      positions[offset] += windValue * 3.2 * delta
      positions[offset + 1] -= RAIN_FALL_SPEED * delta
      positions[offset + 2] += windValue * 0.9 * delta
      if (positions[offset + 1] < 0) {
        positions[offset] = ((index * 17) % 61) - RAIN_FIELD_HALF_SPAN
        positions[offset + 1] = RAIN_RESET_BASE_Y + ((index * 11) % 12)
        positions[offset + 2] = ((index * 29) % 61) - RAIN_FIELD_HALF_SPAN
      }
      positions[offset + 3] = positions[offset] + 0.025 + windValue * 0.035
      positions[offset + 4] = positions[offset + 1] - 0.48
      positions[offset + 5] = positions[offset + 2] + 0.01 + windValue * 0.015
    }
    geometry.attributes.position.needsUpdate = true
  }

  function followCamera(position) {
    // 只跟随水平面；y 恒为 0，雨层从地面升起，不随总览相机高度上浮。
    object.position.x = position.x
    object.position.z = position.z
    object.position.y = 0
  }

  function setVisible(visible) {
    object.visible = Boolean(visible)
  }

  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    geometry.dispose()
    material.dispose()
  }

  return {
    object,
    update,
    followCamera,
    setVisible,
    get visible() {
      return object.visible
    },
    dispose,
  }
}
