/**
 * Canonical player traversal dimensions and movement limits for the sandbox.
 * All values use world units (1 unit ~= 1 metre) and degrees for slope angles.
 */
export const DEFAULT_CHARACTER_TRAVERSAL_PROFILE = Object.freeze({
  height: 1.7,
  radius: 0.55,
  maxStepHeight: 0.45,
  jumpHeight: 1.1,
  jumpMaxDistance: 3,
  maxSlopeClimbAngleDegrees: 50,
  minSlopeSlideAngleDegrees: 30,
  minStepWidth: 0.275,
  snapToGroundDistance: 0.25,
  colliderOffset: 0.01,
})

function finitePositive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/**
 * Resolve partial character settings without allowing impossible capsule sizes
 * or invalid angular thresholds into the physics controller.
 */
export function normalizeCharacterTraversalProfile(input = {}, base = DEFAULT_CHARACTER_TRAVERSAL_PROFILE) {
  const source = input && typeof input === 'object' ? input : {}
  const fallback = base && typeof base === 'object' ? base : DEFAULT_CHARACTER_TRAVERSAL_PROFILE
  const radius = finitePositive(source.radius, fallback.radius)
  const height = Math.max(radius * 2 + 0.02, finitePositive(source.height, fallback.height))
  const maxSlope = Number(source.maxSlopeClimbAngleDegrees)
  const minSlope = Number(source.minSlopeSlideAngleDegrees)
  return {
    height,
    radius,
    maxStepHeight: finitePositive(source.maxStepHeight, fallback.maxStepHeight),
    jumpHeight: finitePositive(source.jumpHeight, fallback.jumpHeight),
    jumpMaxDistance: finitePositive(source.jumpMaxDistance, fallback.jumpMaxDistance),
    maxSlopeClimbAngleDegrees: Number.isFinite(maxSlope)
      ? Math.max(1, Math.min(89, maxSlope))
      : fallback.maxSlopeClimbAngleDegrees,
    minSlopeSlideAngleDegrees: Number.isFinite(minSlope)
      ? Math.max(0, Math.min(88, minSlope))
      : fallback.minSlopeSlideAngleDegrees,
    minStepWidth: finitePositive(source.minStepWidth, Math.max(0.15, radius * 0.5)),
    snapToGroundDistance: finitePositive(source.snapToGroundDistance, fallback.snapToGroundDistance),
    colliderOffset: finitePositive(source.colliderOffset, fallback.colliderOffset),
  }
}
