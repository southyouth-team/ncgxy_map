import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const MODEL_ROOT = '/models/buildings/'

/**
 * 只加载状态为 ready 且模型路径、位置、旋转均明确的 GLB。
 * 待制作资产仍保留在清单中，但不会被误加载到原点。
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
  const skipped = []
  const seenIds = new Set()

  for (const building of buildings) {
    if (!building || typeof building.buildingId !== 'string' || !building.buildingId.trim()) {
      skipped.push({ buildingId: null, code: 'ASSET_BUILDING_ID_MISSING', reason: '清单条目缺少 buildingId' })
      continue
    }
    const buildingId = building.buildingId
    if (seenIds.has(buildingId)) {
      errors.push({ buildingId, code: 'ASSET_BUILDING_ID_DUPLICATE', error: new Error('建筑资产清单存在重复 buildingId') })
      continue
    }
    seenIds.add(buildingId)

    if (building.status !== 'ready') {
      skipped.push({ buildingId, code: 'ASSET_NOT_READY', reason: '资产状态不是 ready' })
      continue
    }

    const modelUrl = building.modelUrl
    if (typeof modelUrl !== 'string' || !modelUrl.startsWith(MODEL_ROOT)
      || !modelUrl.toLowerCase().endsWith('.glb') || modelUrl.includes('..')) {
      errors.push({ buildingId, code: 'ASSET_MODEL_URL_INVALID', error: new Error('modelUrl 必须是 /models/buildings/ 下的 GLB 文件路径') })
      continue
    }
    if (!Array.isArray(building.position) || building.position.length !== 3 || !building.position.every(Number.isFinite)) {
      errors.push({ buildingId, code: 'ASSET_POSITION_INVALID', error: new Error('ready 资产必须提供三个有限数值组成的 position') })
      continue
    }
    if (!Number.isFinite(building.rotationY)) {
      errors.push({ buildingId, code: 'ASSET_ROTATION_INVALID', error: new Error('ready 资产必须明确提供 rotationY（弧度）') })
      continue
    }

    try {
      const gltf = await loader.loadAsync(modelUrl)
      const model = gltf.scene
      model.name = buildingId
      model.position.set(building.position[0], building.position[1], building.position[2])
      model.rotation.y = building.rotationY
      model.userData.buildingId = buildingId
      model.userData.objectType = 'building'
      model.userData.buildingName = building.name || buildingId
      model.traverse((object) => {
        if (!object.isMesh) return
        object.castShadow = true
        object.receiveShadow = true
      })

      scene.add(model)
      loaded.push(buildingId)
      models.push(model)
    } catch (error) {
      errors.push({ buildingId, code: 'ASSET_GLB_LOAD_FAILED', error })
    }
  }

  return { loaded, models, errors, skipped, manifest, total: buildings.length }
}
