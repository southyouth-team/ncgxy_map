// Minimal MVP world made from seamless, independently managed ground chunks.
// The world grows by adding adjacent chunks; existing world-space coordinates never move.
export function createBlankSandboxScene(THREE, dimensions = {}) {
  const chunkWidth = Math.max(20, Number(dimensions.width) || 54)
  const chunkDepth = Math.max(20, Number(dimensions.depth) || 42)
  const root = new THREE.Group()
  root.name = 'WorldSandboxBlankGround'

  // The sandbox has finite walkable chunks; do not place an infinite fallback plane beneath reclaimed holes.

  const chunkGroup = new THREE.Group()
  chunkGroup.name = 'SandboxWorldChunks'
  root.add(chunkGroup)
  const chunks = new Map()
  const chunkVisuals = new Map()
  let chunkManagementEnabled = false
  let selectedChunkKeys = new Set()
  let boundary = null
  const bounds = {
    minX: -chunkWidth / 2, maxX: chunkWidth / 2,
    minZ: -chunkDepth / 2, maxZ: chunkDepth / 2,
  }

  function addChunk(chunkX, chunkZ) {
    const key = chunkX + ':' + chunkZ
    if (chunks.has(key)) return false
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(chunkWidth, chunkDepth),
      new THREE.MeshStandardMaterial({ color: '#929b94', roughness: 0.96, metalness: 0 }),
    )
    ground.name = 'sandbox-ground-chunk-' + key
    ground.rotation.x = -Math.PI / 2
    ground.position.set(chunkX * chunkWidth, 0, chunkZ * chunkDepth)
    ground.receiveShadow = true
    ground.userData.worldChunk = { x: chunkX, z: chunkZ, width: chunkWidth, depth: chunkDepth }
    chunkGroup.add(ground)
    const selectionFill = new THREE.Mesh(
      new THREE.PlaneGeometry(chunkWidth - 0.16, chunkDepth - 0.16),
      new THREE.MeshBasicMaterial({ color: '#9bd8a6', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    )
    selectionFill.name = 'sandbox-chunk-selection-fill-' + key
    selectionFill.rotation.x = -Math.PI / 2
    selectionFill.position.set(chunkX * chunkWidth, 0.035, chunkZ * chunkDepth)
    selectionFill.visible = false
    selectionFill.raycast = () => {}
    root.add(selectionFill)
    const selectionOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(chunkWidth, chunkDepth)),
      new THREE.LineBasicMaterial({ color: '#d4e7d8', transparent: true, opacity: 0.72 }),
    )
    selectionOutline.name = 'sandbox-chunk-selection-outline-' + key
    selectionOutline.rotation.x = -Math.PI / 2
    selectionOutline.position.set(chunkX * chunkWidth, 0.045, chunkZ * chunkDepth)
    selectionOutline.visible = false
    selectionOutline.raycast = () => {}
    root.add(selectionOutline)
    chunkVisuals.set(key, { fill: selectionFill, outline: selectionOutline })
    chunks.set(key, ground)
    updateChunkVisual(key)
    return true
  }

  function updateChunkVisual(key) {
    const visual = chunkVisuals.get(key)
    if (!visual) return
    const selected = selectedChunkKeys.has(key)
    visual.outline.visible = chunkManagementEnabled
    visual.outline.material.color.set(selected ? '#f4e6a3' : '#d4e7d8')
    visual.outline.material.opacity = selected ? 1 : 0.72
    visual.fill.visible = chunkManagementEnabled && selected
  }

  function setChunkManagementState(enabled, selection = []) {
    chunkManagementEnabled = Boolean(enabled)
    selectedChunkKeys = new Set((Array.isArray(selection) ? selection : []).map(item => {
      if (typeof item === 'string') return item
      return Number.isInteger(Number(item?.x)) && Number.isInteger(Number(item?.z)) ? Number(item.x) + ':' + Number(item.z) : ''
    }).filter(Boolean))
    for (const key of chunkVisuals.keys()) updateChunkVisual(key)
  }

  function rebuildBoundary() {
    if (boundary) {
      root.remove(boundary)
      boundary.geometry?.dispose?.()
      boundary.material?.dispose?.()
    }
    const width = bounds.maxX - bounds.minX
    const depth = bounds.maxZ - bounds.minZ
    boundary = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, depth)),
      new THREE.LineBasicMaterial({ color: '#c4d0c8', transparent: true, opacity: 0.7 }),
    )
    boundary.name = 'sandbox-world-boundary'
    boundary.rotation.x = -Math.PI / 2
    boundary.position.set((bounds.minX + bounds.maxX) / 2, 0.025, (bounds.minZ + bounds.maxZ) / 2)
    root.add(boundary)
  }

  addChunk(0, 0)
  rebuildBoundary()

  function expandWorld(direction, count = 1) {
    const normalized = String(direction || '').toLowerCase()
    if (!['north', 'south', 'east', 'west'].includes(normalized)) return false
    const amount = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)))
    const initialCoordinates = Array.from(chunks.values(), item => item.userData.worldChunk)
    const initialMinX = Math.min(...initialCoordinates.map(item => item.x))
    const initialMaxX = Math.max(...initialCoordinates.map(item => item.x))
    const initialMinZ = Math.min(...initialCoordinates.map(item => item.z))
    const initialMaxZ = Math.max(...initialCoordinates.map(item => item.z))
    const projectedWidth = initialMaxX - initialMinX + 1 + (normalized === 'east' || normalized === 'west' ? amount : 0)
    const projectedDepth = initialMaxZ - initialMinZ + 1 + (normalized === 'north' || normalized === 'south' ? amount : 0)
    if (projectedWidth * projectedDepth > 2500) return false
    for (let layer = 0; layer < amount; layer += 1) {
      const coordinates = Array.from(chunks.values(), item => item.userData.worldChunk)
      const minX = Math.min(...coordinates.map(item => item.x))
      const maxX = Math.max(...coordinates.map(item => item.x))
      const minZ = Math.min(...coordinates.map(item => item.z))
      const maxZ = Math.max(...coordinates.map(item => item.z))
      if (normalized === 'east' || normalized === 'west') {
        const x = normalized === 'east' ? maxX + 1 : minX - 1
        for (let z = minZ; z <= maxZ; z += 1) addChunk(x, z)
      } else {
        const z = normalized === 'south' ? maxZ + 1 : minZ - 1
        for (let x = minX; x <= maxX; x += 1) addChunk(x, z)
      }
    }
    const coordinates = Array.from(chunks.values(), item => item.userData.worldChunk)
    const restoredXs = coordinates.map(item => item.x)
    const restoredZs = coordinates.map(item => item.z)
    bounds.minX = Math.min(...restoredXs) * chunkWidth - chunkWidth / 2
    bounds.maxX = Math.max(...restoredXs) * chunkWidth + chunkWidth / 2
    bounds.minZ = Math.min(...restoredZs) * chunkDepth - chunkDepth / 2
    bounds.maxZ = Math.max(...restoredZs) * chunkDepth + chunkDepth / 2
    root.userData.sampleBounds.width = bounds.maxX - bounds.minX
    root.userData.sampleBounds.depth = bounds.maxZ - bounds.minZ
    root.userData.sampleBounds.centerX = (bounds.minX + bounds.maxX) / 2
    root.userData.sampleBounds.centerZ = (bounds.minZ + bounds.maxZ) / 2
    root.userData.worldChunks = coordinates.map(({ x, z }) => ({ x, z }))
    rebuildBoundary()
    return true
  }

  function updateWorldBounds() {
    const coordinates = Array.from(chunks.values(), item => item.userData.worldChunk)
    const xs = coordinates.map(item => item.x)
    const zs = coordinates.map(item => item.z)
    bounds.minX = Math.min(...xs) * chunkWidth - chunkWidth / 2
    bounds.maxX = Math.max(...xs) * chunkWidth + chunkWidth / 2
    bounds.minZ = Math.min(...zs) * chunkDepth - chunkDepth / 2
    bounds.maxZ = Math.max(...zs) * chunkDepth + chunkDepth / 2
    root.userData.sampleBounds.width = bounds.maxX - bounds.minX
    root.userData.sampleBounds.depth = bounds.maxZ - bounds.minZ
    root.userData.sampleBounds.centerX = (bounds.minX + bounds.maxX) / 2
    root.userData.sampleBounds.centerZ = (bounds.minZ + bounds.maxZ) / 2
    root.userData.worldChunks = coordinates.map(({ x, z }) => ({ x, z }))
    rebuildBoundary()
  }

  function removeWorldChunk(chunkX, chunkZ) {
    const x = Number(chunkX), z = Number(chunkZ)
    if (!Number.isInteger(x) || !Number.isInteger(z)) return false
    if (x === 0 && z === 0) return false
    const key = x + ':' + z
    const ground = chunks.get(key)
    if (!ground || chunks.size <= 1) return false
    chunkGroup.remove(ground)
    const visual = chunkVisuals.get(key)
    if (visual) {
      root.remove(visual.fill, visual.outline)
      visual.fill.geometry?.dispose?.()
      visual.fill.material?.dispose?.()
      visual.outline.geometry?.dispose?.()
      visual.outline.material?.dispose?.()
      chunkVisuals.delete(key)
    }
    ground.geometry?.dispose?.()
    if (Array.isArray(ground.material)) ground.material.forEach(material => material?.dispose?.())
    else ground.material?.dispose?.()
    chunks.delete(key)
    updateWorldBounds()
    return true
  }

  root.userData.sampleBounds = { width: chunkWidth, depth: chunkDepth, centerX: 0, centerZ: 0 }
  root.userData.walkableBounds = bounds
  root.userData.playerSpawn = { x: 0, z: Math.min(chunkDepth / 2 - 3, 14) }

  // Blank sandbox still needs a visible controllable avatar; the camera rig alone is not a rendered character.
  const playerAvatar = new THREE.Group()
  playerAvatar.name = 'PixelExplorerSprite'
  const avatarMaterials = {
    body: new THREE.MeshStandardMaterial({ color: '#2878c7', roughness: 0.78 }),
    trim: new THREE.MeshStandardMaterial({ color: '#f0c45a', roughness: 0.72 }),
    skin: new THREE.MeshStandardMaterial({ color: '#e7b58e', roughness: 0.86 }),
    dark: new THREE.MeshStandardMaterial({ color: '#263442', roughness: 0.9 }),
    marker: new THREE.MeshBasicMaterial({ color: '#f5d76e', transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  }
  const addAvatarPart = (name, geometry, material, position) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    playerAvatar.add(mesh)
    return mesh
  }
  addAvatarPart('avatar-body', new THREE.CylinderGeometry(0.27, 0.32, 0.92, 10), avatarMaterials.body, [0, 1.28, 0])
  addAvatarPart('avatar-head', new THREE.SphereGeometry(0.29, 12, 10), avatarMaterials.skin, [0, 2.02, 0])
  addAvatarPart('avatar-hair', new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.48), avatarMaterials.dark, [0, 2.13, -0.015])
  addAvatarPart('avatar-belt', new THREE.CylinderGeometry(0.31, 0.31, 0.12, 10), avatarMaterials.trim, [0, 0.88, 0])
  const leftLeg = addAvatarPart('avatar-left-leg', new THREE.CylinderGeometry(0.105, 0.12, 0.62, 8), avatarMaterials.dark, [-0.14, 0.39, 0])
  const rightLeg = addAvatarPart('avatar-right-leg', new THREE.CylinderGeometry(0.105, 0.12, 0.62, 8), avatarMaterials.dark, [0.14, 0.39, 0])
  const leftArm = addAvatarPart('avatar-left-arm', new THREE.CylinderGeometry(0.085, 0.1, 0.68, 8), avatarMaterials.trim, [-0.34, 1.35, 0])
  const rightArm = addAvatarPart('avatar-right-arm', new THREE.CylinderGeometry(0.085, 0.1, 0.68, 8), avatarMaterials.trim, [0.34, 1.35, 0])
  const playerMarker = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.58, 32), avatarMaterials.marker)
  playerMarker.name = 'avatar-ground-marker'
  playerMarker.rotation.x = -Math.PI / 2
  playerMarker.position.y = 0.035
  playerMarker.receiveShadow = true
  playerAvatar.add(playerMarker)
  playerAvatar.userData.updateAnimation = (moving, time) => {
    const stride = moving ? Math.sin(time * 10) * 0.48 : 0
    leftLeg.rotation.x = stride
    rightLeg.rotation.x = -stride
    leftArm.rotation.x = -stride * 0.7
    rightArm.rotation.x = stride * 0.7
    playerAvatar.position.y = moving ? Math.abs(Math.sin(time * 10)) * 0.045 : 0
  }
  playerAvatar.position.set(root.userData.playerSpawn.x, 0, root.userData.playerSpawn.z)
  root.add(playerAvatar)
  root.userData.worldChunks = [{ x: 0, z: 0 }]
  root.userData.worldChunkSize = { width: chunkWidth, depth: chunkDepth }
  root.userData.expandWorld = expandWorld
  root.userData.removeWorldChunk = removeWorldChunk
  root.userData.setChunkManagementState = setChunkManagementState
  root.userData.getWorldState = () => ({
    version: 1,
    chunkSize: { width: chunkWidth, depth: chunkDepth },
    chunks: Array.from(chunks.values(), item => ({ ...item.userData.worldChunk })).map(({ x, z }) => ({ x, z })),
    bounds: { ...bounds },
  })
  root.userData.restoreWorldState = state => {
    const savedWidth = Number(state?.chunkSize?.width)
    const savedDepth = Number(state?.chunkSize?.depth)
    const entries = state?.version === 1 && Array.isArray(state?.chunks) ? state.chunks : null
    if (!entries || savedWidth !== chunkWidth || savedDepth !== chunkDepth || entries.length > 2500) return false
    const parsed = entries.map(item => ({ x: Number(item?.x), z: Number(item?.z) }))
    if (parsed.some(({ x, z }) => !Number.isInteger(x) || !Number.isInteger(z) || Math.abs(x) > 50 || Math.abs(z) > 50)) return false
    const xs = parsed.map(item => item.x), zs = parsed.map(item => item.z)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    if (new Set(parsed.map(item => item.x + ':' + item.z)).size !== parsed.length) return false
    if (!parsed.some(item => item.x === 0 && item.z === 0)) return false
    for (const { x, z } of parsed) addChunk(x, z)
    const coordinates = Array.from(chunks.values(), item => item.userData.worldChunk)
    const restoredXs = coordinates.map(item => item.x)
    const restoredZs = coordinates.map(item => item.z)
    bounds.minX = Math.min(...restoredXs) * chunkWidth - chunkWidth / 2
    bounds.maxX = Math.max(...restoredXs) * chunkWidth + chunkWidth / 2
    bounds.minZ = Math.min(...restoredZs) * chunkDepth - chunkDepth / 2
    bounds.maxZ = Math.max(...restoredZs) * chunkDepth + chunkDepth / 2
    root.userData.sampleBounds.width = bounds.maxX - bounds.minX
    root.userData.sampleBounds.depth = bounds.maxZ - bounds.minZ
    root.userData.sampleBounds.centerX = (bounds.minX + bounds.maxX) / 2
    root.userData.sampleBounds.centerZ = (bounds.minZ + bounds.maxZ) / 2
    root.userData.worldChunks = coordinates.map(({ x, z }) => ({ x, z }))
    rebuildBoundary()
    return true
  }
  return root
}
