import * as THREE from 'three'

const DEFAULT_COLORS = Object.freeze({
  building: '#c8a66e', road: '#777b78', terrain: '#779b65',
  water: '#70c8c7', vegetation: '#39764a', facility: '#d5b77a',
})

/**
 * 根据 GIS Feature 的 GeoJSON 几何构建 Three.js 对象。
 * mapCoordinateToWorld 是地图坐标到世界 X/Z 的唯一转换入口。
 * sceneObject 只提供三维属性，不得覆盖 Feature 的平面几何。
 */
export function buildFeatureObject(feature, sceneObject, options = {}) {
  if (!feature?.geometry?.type) throw new TypeError('GIS Feature 缺少 geometry')
  if (!sceneObject?.type) throw new TypeError('Scene Object 缺少 type')
  const mapper = options.mapCoordinateToWorld
  if (typeof mapper !== 'function') throw new TypeError('必须提供地图坐标转换函数')

  const group = new THREE.Group()
  group.name = sceneObject.name || feature.name || `feature-${feature.id}`
  group.userData = {
    featureId: String(feature.id),
    sceneObjectId: sceneObject.id,
    objectType: sceneObject.type,
  }
  const color = sceneObject.render?.color || DEFAULT_COLORS[sceneObject.type] || '#aaaaaa'
  const material = new THREE.MeshStandardMaterial({
    color, roughness: sceneObject.render?.roughness ?? 0.9,
    metalness: sceneObject.render?.metalness ?? 0,
  })
  const elevation = Number.isFinite(sceneObject.elevation) ? sceneObject.elevation : 0

  switch (feature.geometry.type) {
    case 'Polygon':
      addPolygon(group, feature.geometry.coordinates, mapper, material, elevation, sceneObject)
      break
    case 'MultiPolygon':
      for (const polygon of feature.geometry.coordinates) {
        addPolygon(group, polygon, mapper, material, elevation, sceneObject)
      }
      break
    case 'LineString':
      addLine(group, feature.geometry.coordinates, mapper, material, sceneObject)
      break
    case 'Point':
      addPoint(group, feature.geometry.coordinates, mapper, material, elevation, sceneObject)
      break
    default:
      material.dispose()
      throw new TypeError(`暂不支持 GeoJSON 类型：${feature.geometry.type}`)
  }
  return group
}

function mapRing(ring, mapper) {
  return ring.map((coordinate) => {
    const point = mapper(coordinate)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      throw new TypeError('坐标转换函数必须返回有限数值 x、z')
    }
    return new THREE.Vector2(point.x, -point.z)
  })
}

function addPolygon(group, rings, mapper, material, elevation, sceneObject) {
  if (!Array.isArray(rings) || !rings.length) return
  const outer = mapRing(rings[0], mapper)
  if (outer.length < 4) throw new TypeError('Polygon 外环至少需要 4 个坐标')
  const shape = new THREE.Shape(outer)
  for (const ring of rings.slice(1)) {
    const points = mapRing(ring, mapper)
    if (points.length >= 4) shape.holes.push(new THREE.Path(points))
  }
  const depth = sceneObject.type === 'building'
    ? Math.max(0.2, Number(sceneObject.properties?.floors || 1) * Number(sceneObject.properties?.floorHeight || 3.3))
    : sceneObject.type === 'terrain' ? 0.08 : 0.12
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, elevation, 0)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = sceneObject.name || 'gis-polygon'
  mesh.castShadow = sceneObject.type === 'building'
  mesh.receiveShadow = true
  group.add(mesh)
}

function addLine(group, coordinates, mapper, material, sceneObject) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return
  const points = coordinates.map((coordinate) => {
    const point = mapper(coordinate)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      throw new TypeError('坐标转换函数必须返回有限数值 x、z')
    }
    return new THREE.Vector3(point.x, 0.08, point.z)
  })
  const curve = new THREE.CatmullRomCurve3(points)
  const radius = Math.max(0.08, Number(sceneObject.render?.width || 2) / 2)
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 8), radius, 6, false), material)
  mesh.name = sceneObject.name || 'gis-line'
  mesh.receiveShadow = true
  group.add(mesh)
}

function addPoint(group, coordinate, mapper, material, elevation, sceneObject) {
  const point = mapper(coordinate)
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
    throw new TypeError('坐标转换函数必须返回有限数值 x、z')
  }
  const size = Math.max(0.3, Number(sceneObject.render?.size || 1))
  const geometry = sceneObject.type === 'vegetation'
    ? new THREE.ConeGeometry(size, size * 2, 6)
    : new THREE.BoxGeometry(size, size, size)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(point.x, elevation + size, point.z)
  mesh.name = sceneObject.name || 'gis-point'
  mesh.castShadow = true
  group.add(mesh)
}
