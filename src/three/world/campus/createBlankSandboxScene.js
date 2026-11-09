// Minimal MVP world: a walkable ground plane and world bounds only.
// Campus buildings, roads, trees, water, props and decorative assets are intentionally absent.
export function createBlankSandboxScene(THREE, dimensions = {}) {
  const width = Math.max(20, Number(dimensions.width) || 54)
  const depth = Math.max(20, Number(dimensions.depth) || 42)
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

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: '#929b94', roughness: 0.96, metalness: 0 }),
  )
  ground.name = 'sandbox-ground'
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0
  ground.receiveShadow = true
  root.add(ground)

  const boundary = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, depth)),
    new THREE.LineBasicMaterial({ color: '#c4d0c8', transparent: true, opacity: 0.7 }),
  )
  boundary.name = 'sandbox-world-boundary'
  boundary.rotation.x = -Math.PI / 2
  boundary.position.y = 0.025
  root.add(boundary)

  root.userData.sampleBounds = { width, depth, centerX: 0, centerZ: 0 }
  root.userData.walkableBounds = {
    minX: -width / 2, maxX: width / 2,
    minZ: -depth / 2, maxZ: depth / 2,
  }
  root.userData.playerSpawn = { x: 0, z: Math.min(depth / 2 - 3, 14) }
  return root
}
