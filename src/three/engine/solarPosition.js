const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Lightweight virtual day cycle for sandbox lighting.
 * Hour 6 is sunrise, 12 is solar noon, 18 is sunset.
 * This is intentionally not an astronomical ephemeris.
 */
export function getVirtualSunState(hour = 12) {
  const numericHour = Number(hour)
  const normalizedHour = ((Number.isFinite(numericHour) ? numericHour : 12) % 24 + 24) % 24
  const phase = ((normalizedHour - 6) / 12) * Math.PI
  const elevation = Math.sin(phase)
  const horizontal = Math.cos(phase)
  const rawDirection = [-horizontal * 0.92, Math.max(0.015, elevation), 0.28]
  const length = Math.hypot(...rawDirection) || 1
  const sunDirection = rawDirection.map(value => value / length)
  const daylight = smoothstep(-0.08, 0.28, elevation)
  const isNight = daylight < 0.025
  const lightDirection = isNight
    ? [-sunDirection[0], sunDirection[1], -sunDirection[2]]
    : sunDirection

  return {
    hour: normalizedHour,
    sunElevation: elevation,
    daylight,
    isNight,
    direction: lightDirection,
  }
}
