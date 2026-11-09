/**
 * Audit whether a generated model's declared collision intent is bound to
 * geometry that the current sandbox Physics Runtime can actually register.
 *
 * This is a structural completeness report, not a geometric proof that a
 * doorway is clear or that a character can traverse a route.
 */
function collectParts(root) {
  const parts = new Map()
  const duplicates = new Set()
  root?.traverse?.(object => {
    const id = object.userData?.componentId
    if (typeof id !== 'string' || !id.trim()) return
    if (parts.has(id)) duplicates.add(id)
    else parts.set(id, object)
  })
  return { parts, duplicates }
}

function collectTargetMeshes(target, targetPartId) {
  const meshes = []
  target?.traverse?.(mesh => {
    if (!mesh.isMesh || mesh.visible === false
      || mesh.userData?.physicsCollision === false
      || mesh.userData?.collisionMode === 'none') return
    const ownId = mesh.userData?.componentId
    if (mesh !== target && typeof ownId === 'string' && ownId !== targetPartId) return
    let ancestor = mesh.parent
    while (ancestor && ancestor !== target) {
      const ancestorId = ancestor.userData?.componentId
      if (typeof ancestorId === 'string' && ancestorId !== targetPartId) return
      ancestor = ancestor.parent
    }
    const position = mesh.geometry?.getAttribute?.('position')
    if (!position || position.itemSize < 3 || position.count < 3) return
    const availableCount = mesh.geometry.index?.count ?? position.count
    const start = Math.max(0, Number(mesh.geometry.drawRange?.start) || 0)
    const requestedCount = Number(mesh.geometry.drawRange?.count)
    const end = Math.min(availableCount, Number.isFinite(requestedCount) ? start + requestedCount : availableCount)
    if (end - start >= 3) meshes.push(mesh)
  })
  return meshes
}

function finitePositiveVector(value) {
  return value && ['x', 'y', 'z'].every(key => Number.isFinite(Number(value[key])) && Number(value[key]) > 0)
}

export function analyzeModelCollisionCompleteness(root) {
  const manifest = root?.userData?.proceduralModelCapabilityManifest
  const spatial = manifest?.capabilities?.spatial
  const declarations = spatial?.colliders
  const { parts, duplicates } = collectParts(root)
  const issues = []
  const records = []
  const addIssue = (code, severity, path, detail) => issues.push({ code, severity, path, detail })

  for (const componentId of duplicates) {
    addIssue('collision.component-id.duplicate', 'error', `component:${componentId}`,
      '模型中存在重复 componentId，碰撞目标无法可靠绑定')
  }

  if (parts.size === 0) {
    addIssue('collision.components.missing', 'error', 'model',
      '模型没有带稳定 componentId 的可审计部件组')
  }
  if (!Array.isArray(declarations)
    && [...parts.values()].some(part => part.userData?.collisionPolicy !== 'none')) {
    addIssue('collision.declarations.missing', 'warning', 'capabilities.spatial.colliders',
      '模型存在需要分类或阻挡的部件，但没有提供可执行的碰撞声明；可见 Mesh 不会自动成为 Collider')
  }

  const activeByTarget = new Map()
  const seenDeclarationIds = new Set()
  for (const [index, declaration] of (Array.isArray(declarations) ? declarations : []).entries()) {
    const path = `capabilities.spatial.colliders[${index}]`
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      addIssue('collision.declaration.invalid', 'error', path, '碰撞声明必须是对象')
      continue
    }
    if (typeof declaration.id !== 'string' || !declaration.id.trim()) {
      addIssue('collision.id.required', 'error', path + '.id', '碰撞声明缺少稳定 ID')
    } else if (seenDeclarationIds.has(declaration.id)) {
      addIssue('collision.id.duplicate', 'error', path + '.id', '碰撞声明 ID 重复')
    } else seenDeclarationIds.add(declaration.id)

    const targetPartId = declaration.targetPartId
    if (typeof targetPartId !== 'string' || !targetPartId.trim()) {
      addIssue('collision.target.required', 'error', path + '.targetPartId', '碰撞声明缺少目标 componentId')
      continue
    }
    if (duplicates.has(targetPartId)) {
      addIssue('collision.target.ambiguous', 'error', path + '.targetPartId', '目标 componentId 重复，无法唯一绑定')
      continue
    }
    const target = parts.get(targetPartId)
    if (!target) {
      addIssue('collision.target.missing', 'error', path + '.targetPartId', '目标 componentId 不存在于当前模型')
      continue
    }

    const shape = declaration.shape
    if (!['box', 'mesh'].includes(shape)) {
      addIssue('collision.shape.unsupported', 'error', path + '.shape', '当前 Runtime 仅执行 box 和 mesh 两种碰撞形状')
      continue
    }
    if (shape === 'box' && (!finitePositiveVector(declaration.size))) {
      addIssue('collision.box.size.invalid', 'error', path + '.size', 'Box 碰撞体必须提供正数 x/y/z 尺寸')
      continue
    }
    if (shape === 'box' && declaration.center != null
      && !['x', 'y', 'z'].every(key => Number.isFinite(Number(declaration.center?.[key])))) {
      addIssue('collision.box.center.invalid', 'error', path + '.center', 'Box 碰撞体中心必须是有限的 x/y/z 坐标')
      continue
    }
    const meshes = collectTargetMeshes(target, targetPartId)
    if (shape === 'mesh' && !meshes.length) {
      addIssue('collision.mesh.geometry.missing', 'error', path + '.targetPartId', 'Mesh Collider 没有可注册的有效三角几何')
      continue
    }
    if (declaration.stateCondition != null
      && (!declaration.stateCondition || typeof declaration.stateCondition.key !== 'string'
        || typeof declaration.stateCondition.equals !== 'boolean')) {
      addIssue('collision.state-condition.invalid', 'error', path + '.stateCondition',
        '当前状态条件只支持 key 与布尔 equals')
      continue
    }

    const disabled = declaration.enabled === false || declaration.blocksMovement === false
    records.push({
      id: declaration.id || null,
      targetPartId,
      shape,
      enabled: !disabled,
      bound: true,
      meshCount: meshes.length,
      status: disabled ? 'disabled' : 'registered-candidate',
    })
    if (!disabled) {
      const list = activeByTarget.get(targetPartId) || []
      list.push(declaration)
      activeByTarget.set(targetPartId, list)
    }
  }

  for (const [componentId, part] of parts) {
    const policy = part.userData?.collisionPolicy
    if (policy !== 'required' && policy !== 'none') {
      addIssue('collision.policy.unclassified', 'warning', `component:${componentId}`,
        '部件未明确声明 collisionPolicy: required 或 none，无法确认是否遗漏碰撞')
      continue
    }
    const active = activeByTarget.get(componentId) || []
    if (policy === 'required' && active.length === 0) {
      addIssue('collision.required.missing', 'error', `component:${componentId}`,
        '该部件声明需要阻挡玩家，但没有有效的 Box/Mesh Collider')
    }
    if (policy === 'none' && active.length > 0) {
      addIssue('collision.policy.conflict', 'warning', `component:${componentId}`,
        '部件声明为纯视觉/不阻挡，但同时存在启用的 Collider')
    }
  }

  const blockingIssueCount = issues.filter(issue => issue.severity === 'error').length
  const reviewIssueCount = issues.filter(issue => issue.severity === 'warning').length
  return {
    version: 1,
    status: blockingIssueCount ? 'invalid' : (reviewIssueCount ? 'needs-review' : 'complete'),
    canRegisterDeclaredColliders: blockingIssueCount === 0,
    summary: {
      componentCount: parts.size,
      declarationCount: Array.isArray(declarations) ? declarations.length : 0,
      boundColliderCount: records.filter(record => record.bound).length,
      requiredComponentCount: [...parts.values()].filter(part => part.userData?.collisionPolicy === 'required').length,
      missingRequiredCount: issues.filter(issue => issue.code === 'collision.required.missing').length,
      blockingIssueCount,
      reviewIssueCount,
    },
    records,
    issues,
  }
}
