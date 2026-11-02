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

  isBlocked(x, z) {
    const r = this.radius
    return this.obstacles.some((box) =>
      x > box.minX - r && x < box.maxX + r &&
      z > box.minZ - r && z < box.maxZ + r,
    )
  }

  move(position, dx, dz) {
    const bounds = this.bounds
    const next = {
      x: Math.max(bounds.minX + this.radius, Math.min(bounds.maxX - this.radius, position.x)),
      z: Math.max(bounds.minZ + this.radius, Math.min(bounds.maxZ - this.radius, position.z)),
    }
    const wantedX = Math.max(bounds.minX + this.radius, Math.min(bounds.maxX - this.radius, position.x + dx))
    const wantedZ = Math.max(bounds.minZ + this.radius, Math.min(bounds.maxZ - this.radius, position.z + dz))
    let blockedX = false
    let blockedZ = false

    if (!this.isBlocked(wantedX, next.z)) next.x = wantedX
    else blockedX = true
    if (!this.isBlocked(next.x, wantedZ)) next.z = wantedZ
    else blockedZ = true

    return { ...next, blockedX, blockedZ }
  }
}
