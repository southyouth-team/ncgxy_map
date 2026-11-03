import * as THREE from 'three'
import { imagePixelToWorld, validateCampusLayoutV2 } from '../../../data/campus/campusLayoutV2.js'

const COLLECTION_STYLES = {
  boundary: { color: '#d9bd82', opacity: 0.28, height: 0.035 },
  roads: { color: '#c9a779', opacity: 1, radius: 0.72 },
  waterBodies: { color: '#63b9c5', opacity: 0.86, height: 0.08 },
  bridges: { color: '#8b6747', opacity: 1, radius: 0.38 },
  sportsGrounds: { color: '#a6ad82', opacity: 0.92, height: 0.055 },
  buildingClusters: { color: '#b7a18a', opacity: 0.3, height: 0.04 },
  buildings: { color: '#d9b58c', opacity: 1, height: 3.2 },
  greenSpaces: { color: '#80a96d', opacity: 0.82, height: 0.045 },
  entrances: { color: '#e6a64c', opacity: 1 },
  landmarks: { color: '#d66c4e', opacity: 1 },
}

/**
 * 将 V2 图像像素几何转换为场景世界坐标。
 * 只有通过完整文档校验且具有有效配准参数时才允许转换。
 */
export function campusLayoutV2ToSceneFeatures(documentData) {
  const validation = validateCampusLayoutV2(documentData)
  if (!validation.valid) throw new Error('V2 校园数据校验失败：' + validation.errors.slice(0, 5).join('；'))
  const calibration = documentData.calibration
  if (!calibration || documentData.coordinateSystem.calibrationStatus !== 'calibrated') {
    throw new Error('V2 校园底图尚未完成坐标配准，禁止生成三维场景')
  }
  const convertPoint = ([x, y]) => imagePixelToWorld(x, y, calibration)
  const result = []
  for (const [collection, items] of Object.entries(documentData.features)) {
    const style = COLLECTION_STYLES[collection]
    for (const feature of items) {
      const geometry = feature.geometry
      let coordinates
      if (geometry.type === 'Point') coordinates = convertPoint(geometry.coordinates)
      else if (geometry.type === 'LineString') coordinates = geometry.coordinates.map(convertPoint)
      else coordinates = geometry.coordinates.map(ring => ring.map(convertPoint))
      result.push({
        id: feature.id,
        name: feature.name || feature.id,
        type: feature.type,
        collection,
        status: feature.status,
        confidence: feature.confidence,
        geometryType: geometry.type,
        coordinates,
        style,
      })
    }
  }
  return result
}

/** 创建独立的 V2 场景图层，不修改旧版示意校园。 */
export function createCampusLayoutV2Scene(THREEInstance, documentData) {
  const features = campusLayoutV2ToSceneFeatures(documentData)
  const group = new THREEInstance.Group()
  group.name = 'CampusLayoutV2Scene'
  const makeMaterial = (style, doubleSide = false) => new THREEInstance.MeshStandardMaterial({
    color: style.color,
    transparent: style.opacity < 1,
    opacity: style.opacity,
    roughness: 1,
    side: doubleSide ? THREEInstance.DoubleSide : THREEInstance.FrontSide,
  })
  const addPolygon = (feature, ringSet, style) => {
    if (!ringSet?.length || ringSet[0].length < 4) return
    const outer = ringSet[0]
    const shape = new THREEInstance.Shape(outer.slice(0, -1).map(point => new THREEInstance.Vector2(point.x, -point.z)))
    for (const ring of ringSet.slice(1)) {
      if (ring.length >= 4) shape.holes.push(new THREEInstance.Path(ring.slice(0, -1).map(point => new THREEInstance.Vector2(point.x, -point.z))))
    }
    const geometry = style.height && feature.collection === 'buildings'
      ? new THREEInstance.ExtrudeGeometry(shape, { depth: style.height, bevelEnabled: false })
      : new THREEInstance.ShapeGeometry(shape)
    geometry.rotateX(-Math.PI / 2)
    const mesh = new THREEInstance.Mesh(geometry, makeMaterial(style, true))
    mesh.name = 'v2-' + feature.type + '-' + feature.id
    mesh.position.y = feature.collection === 'buildings' ? 0.08 : style.height || 0.025
    mesh.userData.featureId = feature.id
    mesh.userData.objectType = feature.type
    mesh.userData.displayName = feature.name
    mesh.userData.reviewStatus = feature.status
    mesh.receiveShadow = true
    mesh.castShadow = feature.collection === 'buildings'
    group.add(mesh)
  }
  for (const feature of features) {
    const style = feature.style
    if (feature.geometryType === 'Polygon') {
      addPolygon(feature, feature.coordinates, style)
    } else if (feature.geometryType === 'LineString' && feature.coordinates.length >= 2) {
      const points = feature.coordinates.map(point => new THREEInstance.Vector3(point.x, 0.12, point.z))
      const curve = new THREEInstance.CatmullRomCurve3(points)
      const mesh = new THREEInstance.Mesh(
        new THREEInstance.TubeGeometry(curve, Math.max(16, points.length * 12), style.radius || 0.3, 6, false),
        makeMaterial(style),
      )
      mesh.name = 'v2-' + feature.type + '-' + feature.id
      mesh.userData.featureId = feature.id
      mesh.userData.objectType = feature.type
      mesh.userData.displayName = feature.name
      group.add(mesh)
    } else if (feature.geometryType === 'Point') {
      const marker = new THREEInstance.Mesh(
        new THREEInstance.BoxGeometry(0.9, 1.4, 0.9),
        makeMaterial(style),
      )
      marker.position.set(feature.coordinates.x, 0.7, feature.coordinates.z)
      marker.name = 'v2-' + feature.type + '-' + feature.id
      marker.userData.featureId = feature.id
      marker.userData.objectType = feature.type
      marker.userData.displayName = feature.name
      group.add(marker)
    }
  }
  group.userData.featureCount = features.length
  group.userData.coordinateSystem = 'campus-layout-v2-calibrated'
  return group
}
