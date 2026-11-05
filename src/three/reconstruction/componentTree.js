/**
 * 递归复制扁平 parent 引用组件树中的一个子树。
 * 返回新数组，不修改输入；调用方负责在写回前完成总量预算检查。
 */
export function duplicateComponentSubtree(componentTree, rootId, createId) {
  if (!Array.isArray(componentTree) || typeof createId !== 'function') throw new TypeError('组件树或 ID 生成器无效')
  const byId = new Map(componentTree.map(node => [node.id, node]))
  const root = byId.get(rootId)
  if (!root) throw new RangeError('找不到待复制的根组件')

  const descendants = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of componentTree) {
      if (!descendants.has(node.id) && descendants.has(node.parent)) {
        descendants.add(node.id)
        changed = true
      }
    }
  }

  const ordered = componentTree.filter(node => descendants.has(node.id))
  const idMap = new Map()
  const existingIds = new Set(byId.keys())
  for (const node of ordered) {
    const id = createId()
    if (typeof id !== 'string' || !id || existingIds.has(id) || [...idMap.values()].includes(id)) {
      throw new RangeError('新组件 ID 无效或重复')
    }
    idMap.set(node.id, id)
  }

  const copies = ordered.map(node => {
    const copy = JSON.parse(JSON.stringify(node))
    copy.id = idMap.get(node.id)
    if (descendants.has(node.parent)) copy.parent = idMap.get(node.parent)
    if (node.id === rootId) {
      copy.name = (node.name || '组件') + ' 副本'
      copy.transform = { ...(copy.transform || {}), position: [...(copy.transform?.position || [0, 0, 0])] }
      copy.transform.position[0] += Math.max(0.25, Number(copy.dimensions?.width || 1) * 0.15)
    }
    return copy
  })
  const lastIndex = Math.max(...componentTree.map((node, index) => descendants.has(node.id) ? index : -1))
  const tree = [...componentTree]
  tree.splice(lastIndex + 1, 0, ...copies)
  return { tree, components: copies, rootId: idMap.get(rootId) }
}
