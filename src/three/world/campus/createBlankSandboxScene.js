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
    const savedWidth = Number(state?.chunkSize?.width)
    const savedDepth = Number(state?.chunkSize?.depth)
    const entries = state?.version === 1 && Array.isArray(state?.chunks) ? state.chunks : null
    if (!entries || savedWidth !== chunkWidth || savedDepth !== chunkDepth || entries.length > 2500) return false
    const parsed = entries.map(item => ({ x: Number(item?.x), z: Number(item?.z) }))
    if (parsed.some(({ x, z }) => !Number.isInteger(x) || !Number.isInteger(z) || Math.abs(x) > 50 || Math.abs(z) > 50)) return false
    const xs = parsed.map(item => item.x), zs = parsed.map(item => item.z)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    if ((maxX - minX + 1) * (maxZ - minZ + 1) !== new Set(parsed.map(item => item.x + ':' + item.z)).size) return false
    if (!parsed.some(item => item.x === 0 && item.z === 0)) return false
    for (const { x, z } of parsed) addChunk(x, z)
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
    return true
  }
  return root
}
