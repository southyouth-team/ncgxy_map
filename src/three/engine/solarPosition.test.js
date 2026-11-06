import { describe, expect, it } from 'vitest'
import { getVirtualSunState } from './solarPosition.js'

describe('getVirtualSunState', () => {
  it('places the sun low in the east at sunrise', () => {
    const state = getVirtualSunState(6)
    expect(state.isNight).toBe(false)
    expect(state.sunElevation).toBeCloseTo(0, 8)
    expect(state.direction[0]).toBeLessThan(0)
    expect(state.direction[1]).toBeGreaterThan(0)
  })

  it('places the sun highest at solar noon', () => {
    const state = getVirtualSunState(12)
    expect(state.daylight).toBe(1)
    expect(state.direction[1]).toBeGreaterThan(0.9)
  })

  it('moves the sun to the opposite side by sunset', () => {
    const sunrise = getVirtualSunState(6)
    const sunset = getVirtualSunState(18)
    expect(sunset.direction[0]).toBeGreaterThan(0)
    expect(sunset.direction[0]).toBeCloseTo(-sunrise.direction[0], 5)
  })

  it('switches to a moonlight direction at night', () => {
    const state = getVirtualSunState(22)
    expect(state.isNight).toBe(true)
    expect(state.direction[1]).toBeGreaterThan(0)
    expect(state.daylight).toBe(0)
  })

  it('normalizes values outside the 24-hour range', () => {
    expect(getVirtualSunState(24).hour).toBe(0)
    expect(getVirtualSunState(-2).hour).toBe(22)
  })
})
