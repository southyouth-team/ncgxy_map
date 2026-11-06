/**
 * 校园要素默认通行策略。显式 walkable 布尔值优先于类型默认值。
 */
export function getDefaultWalkable(featureType, properties = {}) {
  if (typeof properties.walkable === 'boolean') return properties.walkable
  if (featureType === 'building' || featureType === 'water') return false
  if (featureType === 'area') {
    const category = properties.category || properties.areaType || properties.type
    return category !== 'water'
  }
  if (featureType === 'object' || featureType === 'facility') {
    const objectType = properties.objectType || properties.type || 'facility'
    return ['flower', 'plant', 'grass', 'decoration'].includes(objectType)
  }
  return true
}
