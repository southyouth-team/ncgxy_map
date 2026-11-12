/**
 * Asset-boundary policy for generated procedural models.
 *
 * The sandbox host owns the environment: sky, sun/moon, time-of-day lighting,
 * weather, fog, ground, cameras and renderers (see createCampusEngine). A
 * generated model may contain only the asset itself, plus functional lights
 * intrinsic to the asset (bulbs, lamps, strips). This guard runs inside the
 * model Worker before serialization, so host-owned environment nodes can never
 * cross into the sandbox through a generated model.
 */
export function assertSandboxModelSubtreeAssetOnly(root) {
  if (!root?.traverse || typeof root.traverse !== 'function') {
    throw new TypeError('模型根节点必须是 THREE.Object3D')
  }

  const violations = []
  root.traverse((object) => {
    const type = object.type || object.constructor?.name || 'Unknown'
    let reason = ''
    if (object.isScene) {
      reason = '场景（THREE.Scene 由宿主提供）'
    } else if (object.isCamera) {
      reason = '相机（相机由宿主提供）'
    } else if (object.isAmbientLight || object.isHemisphereLight || object.isDirectionalLight) {
      reason = '环境光/太阳照明（沙盒已提供昼夜光照）'
    } else if (/Helper$/.test(type)) {
      reason = '编辑器辅助对象（不属于模型本体）'
    }
    if (reason) {
      violations.push(`${type}${object.name ? `「${object.name}」` : ''}：${reason}`)
    }
  })

  if (!violations.length) return
  throw new Error(
    '模型包含宿主专属环境元素，不能放入沙盒：\n- '
      + violations.slice(0, 8).join('\n- ')
      + '\n沙盒已提供天空、太阳、昼夜光照、天气、雾、地面和相机；请重新生成，或让 AI 移除这些元素，只保留模型本体。'
      + '模型自带灯具只能使用 PointLight/SpotLight，并挂在带 userData.componentId 的部件组下。',
  )
}
