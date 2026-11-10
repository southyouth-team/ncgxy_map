import { describe, expect, it } from 'vitest'
import { advanceFrameTiming } from './FrameTiming.js'

describe('advanceFrameTiming', () => {
  it('uses one bounded simulation clock for a normal frame', () => {
    const timing = advanceFrameTiming(1000 + 1000 / 60, 1000, 2)
    expect(timing.deltaSeconds).toBeCloseTo(1 / 60)
    expect(timing.simulationTimeSeconds).toBeCloseTo(2 + 1 / 60)
    expect(timing.droppedFrameTimeSeconds).toBe(0)
  })

  it('keeps animation time aligned with the accepted simulation delta after a stalled frame', () => {
    const timing = advanceFrameTiming(1200, 1000, 4.5, 0.05)
    expect(timing.rawDeltaSeconds).toBeCloseTo(0.2)
    expect(timing.deltaSeconds).toBe(0.05)
    expect(timing.simulationTimeSeconds).toBeCloseTo(4.55)
    expect(timing.droppedFrameTimeSeconds).toBeCloseTo(0.15)
  })

  it('does not move simulation time backwards when timestamps regress', () => {
    const timing = advanceFrameTiming(900, 1000, 3)
    expect(timing.deltaSeconds).toBe(0)
    expect(timing.simulationTimeSeconds).toBe(3)
  })

  it('starts without inventing elapsed time on the first frame', () => {
    const timing = advanceFrameTiming(500, null, 0)
    expect(timing.deltaSeconds).toBe(0)
    expect(timing.simulationTimeSeconds).toBe(0)
  })
})
