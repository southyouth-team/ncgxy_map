/**
 * Collect data-only geometry diagnostics for an AI-generated Three.js model.
 * Findings are evidence for review/AI editing, not automatic repair decisions.
 * AABB overlap is intentionally not classified as an error.
 */
export function collectProceduralModelGeometryDiagnostics(THREE, root) {
  const diagnostics = []
  const meshes = []
  if (!THREE?.Box3 || !root?.traverse) {
    return { version: 1, summary: { meshCount: 0, vertexCount: 0, diagnosticCount: 0 }, meshes, diagnostics }
  }

  root.updateWorldMatrix(true, true)
  let totalVertices = 0
  const isFiniteArray = values => values.every(Number.isFinite)

  root.traverse(object => {
    if (!object?.isMesh || !object.geometry) return
    const geometry = object.geometry
    const position = geometry.getAttribute?.('position')
    const componentId = typeof object.userData?.componentId === 'string'
      ? object.userData.componentId
      : null
    const record = {
      componentId,
      vertexCount: Number(position?.count) || 0,
      localBounds: null,
      worldBounds: null,
    }
    totalVertices += record.vertexCount

    const add = (code, severity, detail) => diagnostics.push({
      code, severity, componentId, detail,
    })

    if (!position || typeof position.getX !== 'function' || position.itemSize < 3) {
      add('missing-position-attribute', 'error', 'Mesh geometry has no usable 3D position attribute')
      meshes.push(record)
      return
    }
    if (position.count === 0) {
      add('empty-geometry', 'warning', 'Position attribute contains no vertices')
      meshes.push(record)
      return
    }

    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    let hasInvalidVertex = false
    for (let i = 0; i < position.count; i += 1) {
      const vertex = [position.getX(i), position.getY(i), position.getZ(i)]
      if (!isFiniteArray(vertex)) {
        hasInvalidVertex = true
        continue
      }
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex[axis])
        max[axis] = Math.max(max[axis], vertex[axis])
      }
    }
    if (hasInvalidVertex) {
      add('non-finite-vertex', 'error', 'Position attribute contains NaN or Infinity')
      meshes.push(record)
      return
    }

    const localMin = new THREE.Vector3(min[0], min[1], min[2])
    const localMax = new THREE.Vector3(max[0], max[1], max[2])
    const localBox = new THREE.Box3(localMin, localMax)
    record.localBounds = { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } }

    const dimensions = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    if (Math.max(...dimensions) <= 1e-8) {
      add('degenerate-geometry-bounds', 'warning', 'All geometry bounds dimensions are effectively zero')
    }

    const matrix = object.matrixWorld?.elements || []
    if (matrix.length !== 16 || !isFiniteArray(Array.from(matrix))) {
      add('non-finite-transform', 'error', 'World transform matrix contains NaN or Infinity')
      meshes.push(record)
      return
    }

    const worldBox = localBox.clone().applyMatrix4(object.matrixWorld)
    const worldValues = [
      worldBox.min.x, worldBox.min.y, worldBox.min.z,
      worldBox.max.x, worldBox.max.y, worldBox.max.z,
    ]
    if (!isFiniteArray(worldValues)) {
      add('non-finite-world-bounds', 'error', 'Transformed geometry bounds contain NaN or Infinity')
      meshes.push(record)
      return
    }
    record.worldBounds = {
      min: { x: worldBox.min.x, y: worldBox.min.y, z: worldBox.min.z },
      max: { x: worldBox.max.x, y: worldBox.max.y, z: worldBox.max.z },
    }
    meshes.push(record)
  })

  return {
    version: 1,
    summary: {
      meshCount: meshes.length,
      vertexCount: totalVertices,
      diagnosticCount: diagnostics.length,
    },
    meshes,
    diagnostics,
  }
}
