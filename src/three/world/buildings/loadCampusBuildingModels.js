import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const MODEL_ROOT = '/models/buildings/'

/**
 * 从建筑清单加载已制作的 GLB。
 * 建筑坐标使用校园本地米制坐标；模型原点应放在建筑 footprint 中心的地面位置。
 */
export async function loadCampusBuildingModels(scene, manifestUrl = '/data/buildings.json') {
  const response = await fetch(manifestUrl)
  if (!response.ok) {
    throw new Error(`建筑资产清单加载失败：HTTP ${response.status}`)
  }

  const manifest = await response.json()
  const buildings = Array.isArray(manifest.buildings) ? manifest.buildings : []
  const loaded = []
  const models = []
  const errors = []

  for (const building of buildings) {
    if (!building || typeof building.buildingId !== 'string') continue
    const modelUrl = building.modelUrl
    if (typeof modelUrl !== 'string' || !modelUrl.startsWith(MODEL_ROOT)) continue

    try {
      const gltf = await loader.loadAsync(modelUrl)
      const model = gltf.scene
      const position = Array.isArray(building.position) ? building.position : [0, 0, 0]
      const rotationY = Number.isFinite(building.rotationY) ? building.rotationY : 0

      model.name = building.buildingId
      model.position.set(
        Number.isFinite(position[0]) ? position[0] : 0,
        Number.isFinite(position[1]) ? position[1] : 0,
        Number.isFinite(position[2]) ? position[2] : 0,
      )
      model.rotation.y = rotationY
      model.userData.buildingId = building.buildingId
      model.userData.objectType = 'building'
      model.userData.buildingName = building.name || building.buildingId
      model.traverse((object) => {
        if (!object.isMesh) return
        object.castShadow = true
        object.receiveShadow = true
      })

      scene.add(model)
      loaded.push(building.buildingId)
      models.push(model)
    } catch (error) {
      errors.push({ buildingId: building.buildingId, error })
    }
  }

  return { loaded, models, errors, total: buildings.length }
}
