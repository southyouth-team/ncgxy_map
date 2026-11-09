/**
 * 轻量级校园漫游碰撞体。
 * 使用 XZ 平面 AABB/多边形障碍 + 角色半径，支持湖岸、岛屿洞区和建筑碰撞。
 * 大步长会拆分为连续小步，避免快速移动跨过窄墙或水域边界。
 */
export class CollisionWorld {
  constructor(bounds, obstacles = [], radius = 0.55) {
    this.bounds = bounds || { minX: -75, maxX: 75, minZ: -75, maxZ: 75 }
    this.obstacles = obstacles.filter((item) =>
      Number.isFinite(item.minX) && Number.isFinite(item.maxX) &&
      Number.isFinite(item.minZ) && Number.isFinite(item.maxZ) &&
      item.maxX > item.minX && item.maxZ > item.minZ,
    )
    this.radius = Math.max(0.1, Number(radius) || 0.55)
    this.supportSurfaces = []
    this.walkableRegions = null
  }

  addObstacle(bounds, ownerId = null) {
    if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) ||
      !Number.isFinite(bounds.minZ) || !Number.isFinite(bounds.maxZ) ||
      bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) return false
    this.obstacles.push({
      minX: bounds.minX, maxX: bounds.maxX,
      minZ: bounds.minZ, maxZ: bounds.maxZ,
      ...(ownerId ? { ownerId: String(ownerId) } : {}),
    })
    return true
  }

  removeObstaclesByOwner(ownerId) {
    if (!ownerId) return 0
    const before = this.obstacles.length
    this.obstacles = this.obstacles.filter(obstacle => obstacle.ownerId !== String(ownerId))
    return before - this.obstacles.length
  }

  addSupportSurface(surface) {
    if (!surface || !surface.ownerId || !surface.surfaceId || !Array.isArray(surface.meshes) || !surface.meshes.length) return false
    if (surface.supportsStanding !== true && surface.walkable !== true) return false
    this.supportSurfaces.push({
      ownerId: String(surface.ownerId),
      surfaceId: String(surface.surfaceId),
      targetPartId: String(surface.targetPartId || ''),
      supportsStanding: surface.supportsStanding === true,
      walkable: surface.walkable === true,
      meshes: surface.meshes,
    })
    return true
  }

  removeSupportSurfacesByOwner(ownerId) {
    if (!ownerId) return 0
    const before = this.supportSurfaces.length
    this.supportSurfaces = this.supportSurfaces.filter(surface => surface.ownerId !== String(ownerId))
    return before - this.supportSurfaces.length
  }

  addCircleObstacle({ x, z, radius } = {}) {
    const centerX = Number(x), centerZ = Number(z), obstacleRadius = Number(radius)
    if (!Number.isFinite(centerX) || !Number.isFinite(centerZ) || !Number.isFinite(obstacleRadius) || obstacleRadius <= 0) return false
    this.obstacles.push({ circle: true, x: centerX, z: centerZ, radius: obstacleRadius,
      minX: centerX - obstacleRadius, maxX: centerX + obstacleRadius,
      minZ: centerZ - obstacleRadius, maxZ: centerZ + obstacleRadius })
    return true
  }

  addPolygonObstacle({ outer = [], holes = [] } = {}) {
    const normalizeRing = ring => Array.isArray(ring)
      ? ring.map(point => Array.isArray(point) ? { x: Number(point[0]), z: Number(point[1]) } : { x: Number(point?.x), z: Number(point?.z) })
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.z))
      : []
    const polygon = normalizeRing(outer)
    const innerRings = holes.map(normalizeRing).filter(ring => ring.length >= 3)
    if (polygon.length < 3) return false
    const xs = polygon.map(point => point.x), zs = polygon.map(point => point.z)
    this.obstacles.push({
      polygon,
      holes: innerRings,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
    })
    return true
  }

  pointInRing(x, z, ring) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j]
      const crosses = (a.z > z) !== (b.z > z)
        && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x
      if (crosses) inside = !inside
    }
    return inside
  }

  distanceToRing(x, z, ring) {
    let distance = Infinity
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index], b = ring[(index + 1) % ring.length]
      const dx = b.x - a.x, dz = b.z - a.z
      const lengthSquared = dx * dx + dz * dz
      const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared)) : 0
      distance = Math.min(distance, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)))
    }
    return distance
  }

  isPolygonBlocked(x, z, obstacle) {
    const r = this.radius
    if (x < obstacle.minX - r || x > obstacle.maxX + r || z < obstacle.minZ - r || z > obstacle.maxZ + r) return false
    const insideOuter = this.pointInRing(x, z, obstacle.polygon)
    const insideHole = obstacle.holes.some(ring => this.pointInRing(x, z, ring))
    if (insideOuter && !insideHole) return true
    if (this.distanceToRing(x, z, obstacle.polygon) <= r) return true
    return obstacle.holes.some(ring => this.distanceToRing(x, z, ring) <= r)
  }

  isObstacleBlocked(x, z, obstacle) {
    const r = this.radius
    if (obstacle.polygon) return this.isPolygonBlocked(x, z, obstacle)
    if (obstacle.circle) return Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + r
    return x > obstacle.minX - r && x < obstacle.maxX + r &&
      z > obstacle.minZ - r && z < obstacle.maxZ + r
  }

  setWalkableRegions(regions) {
    this.walkableRegions = Array.isArray(regions)
      ? regions.filter(region => Number.isFinite(region.minX) && Number.isFinite(region.maxX)
        && Number.isFinite(region.minZ) && Number.isFinite(region.maxZ)
        && region.maxX > region.minX && region.maxZ > region.minZ)
      : null
  }

  isInsideWalkableRegions(x, z) {
    if (!this.walkableRegions) return true
    const inside = (px, pz) => this.walkableRegions.some(region => (
      px >= region.minX && px <= region.maxX
      && pz >= region.minZ && pz <= region.maxZ
    ))
    // Probe the player's footprint, not just its center. Adjacent chunks form one
    // continuous walkable union, while a reclaimed chunk remains a hard boundary.
    const r = this.radius * 0.82
    const probes = [
      [x, z], [x - r, z], [x + r, z], [x, z - r], [x, z + r],
      [x - r * 0.7, z - r * 0.7], [x + r * 0.7, z - r * 0.7],
      [x - r * 0.7, z + r * 0.7], [x + r * 0.7, z + r * 0.7],
    ]
    return probes.every(([px, pz]) => inside(px, pz))
  }

  isBlocked(x, z) {
    if (!this.isInsideWalkableRegions(x, z)) return true
    return this.obstacles.some(obstacle => this.isObstacleBlocked(x, z, obstacle))
  }

  resolvePosition(position) {
    const r = this.radius
    const resolved = {
      x: Math.max(this.bounds.minX + r, Math.min(this.bounds.maxX - r, position.x)),
      z: Math.max(this.bounds.minZ + r, Math.min(this.bounds.maxZ - r, position.z)),
    }
    // 如果出生点或场景切换点落在碰撞体内，逐次推到最近可行边界，避免角色永久卡死。
    for (let iteration = 0; iteration < this.obstacles.length + 2; iteration++) {
      const obstacle = this.obstacles.find(box => this.isObstacleBlocked(resolved.x, resolved.z, box))
      if (!obstacle) break
      const candidates = [
        { x: obstacle.minX - r - 0.015, z: resolved.z },
        { x: obstacle.maxX + r + 0.015, z: resolved.z },
        { x: resolved.x, z: obstacle.minZ - r - 0.015 },
        { x: resolved.x, z: obstacle.maxZ + r + 0.015 },
      ].map(point => ({
        x: Math.max(this.bounds.minX + r, Math.min(this.bounds.maxX - r, point.x)),
        z: Math.max(this.bounds.minZ + r, Math.min(this.bounds.maxZ - r, point.z)),
      })).filter(point => !this.isBlocked(point.x, point.z))
      if (!candidates.length) break
      candidates.sort((a, b) => Math.hypot(a.x - resolved.x, a.z - resolved.z) - Math.hypot(b.x - resolved.x, b.z - resolved.z))
      resolved.x = candidates[0].x
      resolved.z = candidates[0].z
    }
    return resolved
  }

  move(position, dx, dz) {
    const start = this.resolvePosition(position)
    const r = this.radius, bounds = this.bounds
    // 将大步长拆分，避免快速移动时跨过窄墙/建筑边界。
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / Math.max(0.12, r * 0.5)))
    const stepX = dx / steps, stepZ = dz / steps
    const next = { ...start }
    let blockedX = false, blockedZ = false
    for (let step = 0; step < steps; step += 1) {
      const wantedX = Math.max(bounds.minX + r, Math.min(bounds.maxX - r, next.x + stepX))
      const wantedZ = Math.max(bounds.minZ + r, Math.min(bounds.maxZ - r, next.z + stepZ))
      const xFirst = { ...next }, zFirst = { ...next }
      if (!this.isBlocked(wantedX, xFirst.z)) xFirst.x = wantedX
      else blockedX = true
      if (!this.isBlocked(xFirst.x, wantedZ)) xFirst.z = wantedZ
      else blockedZ = true
      if (!this.isBlocked(zFirst.x, wantedZ)) zFirst.z = wantedZ
      if (!this.isBlocked(wantedX, zFirst.z)) zFirst.x = wantedX
      const xDistance = (xFirst.x - next.x) ** 2 + (xFirst.z - next.z) ** 2
      const zDistance = (zFirst.x - next.x) ** 2 + (zFirst.z - next.z) ** 2
      const chosen = zDistance > xDistance ? zFirst : xFirst
      next.x = chosen.x
      next.z = chosen.z
    }
    return { ...next, blockedX, blockedZ }
  }
}
