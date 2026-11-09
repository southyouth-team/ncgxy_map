// Minimal MVP world made from seamless, independently managed ground chunks.
// The world grows by adding adjacent chunks; existing world-space coordinates never move.
export function createBlankSandboxScene(THREE, dimensions = {}) {
  const chunkWidth = Math.max(20, Number(dimensions.width) || 54)
  const chunkDepth = Math.max(20, Number(dimensions.depth) || 42)
  const root = new THREE.Group()
  root.name = 'WorldSandboxBlankGround'

  const horizon = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000),
    new THREE.MeshStandardMaterial({ color: '#748078', roughness: 1 }),
  )
  horizon.name = 'sandbox-horizon-ground'
  horizon.rotation.x = -Math.PI / 2
  horizon.position.y = -0.025
  horizon.receiveShadow = true
  root.add(horizon)

  const chunkGroup = new THREE.Group()
  chunkGroup.name = 'SandboxWorldChunks'
  root.add(chunkGroup)
  const chunks = new Map()
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
    chunks.set(key, ground)
    return true
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
    for (let index = 0; index < amount; index += 1) {
      const xs = Array.from(chunks.values(), item => item.userData.worldChunk.x)
      const zs = Array.from(chunks.values(), item => item.userData.worldChunk.z)
      const nextX = normalized === 'east' ? Math.max(...xs) + 1
        : normalized === 'west' ? Math.min(...xs) - 1
          : Math.round((Math.min(...xs) + Math.max(...xs)) / 2)
      const nextZ = normalized === 'south' ? Math.max(...zs) + 1
        : normalized === 'north' ? Math.min(...zs) - 1
          : Math.round((Math.min(...zs) + Math.max(...zs)) / 2)
      addChunk(nextX, nextZ)
    }
    const xs = Array.from(chunks.values(), item => item.userData.worldChunk.x)
    const zs = Array.from(chunks.values(), item => item.userData.worldChunk.z)
    bounds.minX = Math.min(...xs) * chunkWidth - chunkWidth / 2
    bounds.maxX = Math.max(...xs) * chunkWidth + chunkWidth / 2
    bounds.minZ = Math.min(...zs) * chunkDepth - chunkDepth / 2
    bounds.maxZ = Math.max(...zs) * chunkDepth + chunkDepth / 2
    root.userData.sampleBounds.width = bounds.maxX - bounds.minX
    root.userData.sampleBounds.depth = bounds.maxZ - bounds.minZ
    root.userData.sampleBounds.centerX = (bounds.minX + bounds.maxX) / 2
    root.userData.sampleBounds.centerZ = (bounds.minZ + bounds.maxZ) / 2
    rebuildBoundary()
    return true
  }

  root.userData.sampleBounds = { width: chunkWidth, depth: chunkDepth, centerX: 0, centerZ: 0 }
  root.userData.walkableBounds = bounds
  root.userData.playerSpawn = { x: 0, z: Math.min(chunkDepth / 2 - 3, 14) }
  root.userData.worldChunks = [{ x: 0, z: 0 }]
  root.userData.worldChunkSize = { width: chunkWidth, depth: chunkDepth }
  root.userData.expandWorld = expandWorld
  root.userData.getWorldState = () => ({
    version: 1,
    chunkSize: { width: chunkWidth, depth: chunkDepth },
    chunks: Array.from(chunks.values(), item => ({ ...item.userData.worldChunk })).map(({ x, z }) => ({ x, z })),
    bounds: { ...bounds },
  })
  root.userData.restoreWorldState = state => {
    const entries = Array.isArray(state?.chunks) ? state.chunks : []
    for (const item of entries) {
      const x = Number(item?.x), z = Number(item?.z)
      if (Number.isInteger(x) && Number.isInteger(z)) addChunk(x, z)
    }
    const xs = Array.from(chunks.values(), item => item.userData.worldChunk.x)
    const zs = Array.from(chunks.values(), item => item.userData.worldChunk.z)
    bounds.minX = Math.min(...xs) * chunkWidth - chunkWidth / 2
    bounds.maxX = Math.max(...xs) * chunkWidth + chunkWidth / 2
    bounds.minZ = Math.min(...zs) * chunkDepth - chunkDepth / 2
    bounds.maxZ = Math.max(...zs) * chunkDepth + chunkDepth / 2
    root.userData.sampleBounds.width = bounds.maxX - bounds.minX
    root.userData.sampleBounds.depth = bounds.maxZ - bounds.minZ
    root.userData.sampleBounds.centerX = (bounds.minX + bounds.maxX) / 2
    root.userData.sampleBounds.centerZ = (bounds.minZ + bounds.maxZ) / 2
    rebuildBoundary()
    return true
  }
  return root
}
