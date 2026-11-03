/**
 * 轻量级校园漫游碰撞体。
 * 使用 XZ 平面 AABB + 角色半径，提供轴向滑动，避免角色穿过建筑。
 * 当前用于室外建筑边界；复杂室内碰撞后续可替换为分区碰撞网格。
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
  }

  addObstacle(bounds) {
    if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) ||
      !Number.isFinite(bounds.minZ) || !Number.isFinite(bounds.maxZ) ||
      bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) return false
    this.obstacles.push({
      minX: bounds.minX, maxX: bounds.maxX,
      minZ: bounds.minZ, maxZ: bounds.maxZ,
    })
    return true
  }

  isBlocked(x, z) {
    const r = this.radius
    return this.obstacles.some((box) =>
      x > box.minX - r && x < box.maxX + r &&
      z > box.minZ - r && z < box.maxZ + r,
    )
  }

  resolvePosition(position) {
    const r = this.radius
    const resolved = {
      x: Math.max(this.bounds.minX + r, Math.min(this.bounds.maxX - r, position.x)),
      z: Math.max(this.bounds.minZ + r, Math.min(this.bounds.maxZ - r, position.z)),
    }
    // 如果出生点或场景切换点落在碰撞体内，逐次推到最近可行边界，避免角色永久卡死。
    for (let iteration = 0; iteration < this.obstacles.length + 2; iteration++) {
      const obstacle = this.obstacles.find(box => this.isBlocked(resolved.x, resolved.z) &&
        resolved.x > box.minX - r && resolved.x < box.maxX + r &&
        resolved.z > box.minZ - r && resolved.z < box.maxZ + r)
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
    const wantedX = Math.max(bounds.minX + r, Math.min(bounds.maxX - r, start.x + dx))
    const wantedZ = Math.max(bounds.minZ + r, Math.min(bounds.maxZ - r, start.z + dz))
    const xFirst = { ...start }, zFirst = { ...start }
    let xBlocked = false, zBlocked = false
    if (!this.isBlocked(wantedX, xFirst.z)) xFirst.x = wantedX
    else xBlocked = true
    if (!this.isBlocked(xFirst.x, wantedZ)) xFirst.z = wantedZ
    else zBlocked = true
    if (!this.isBlocked(zFirst.x, wantedZ)) zFirst.z = wantedZ
    if (!this.isBlocked(wantedX, zFirst.z)) zFirst.x = wantedX
    const xDistance = (xFirst.x - start.x) ** 2 + (xFirst.z - start.z) ** 2
    const zDistance = (zFirst.x - start.x) ** 2 + (zFirst.z - start.z) ** 2
    const next = zDistance > xDistance ? zFirst : xFirst
    return { ...next, blockedX: xBlocked, blockedZ: zBlocked }
  }
}
