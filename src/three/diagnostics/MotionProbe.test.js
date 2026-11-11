import { describe, expect, it } from 'vitest'
import { extractMotionStalls, MotionProbe, summarizeMotion } from './MotionProbe.js'

function frame(overrides = {}) {
  return {
    t: 0,
    intervalMs: 8.33,
    px: 0, py: 1.7, pz: 0,
    dx: 0, dy: 0, dz: 0,
    keysHeld: 0,
    movementIntent: false,
    physicsSteps: 0,
    physicsAlpha: 0,
    grounded: true,
    renderCostMs: 1,
    drawCalls: 5,
    triangles: 1200,
    shadowInvalidated: false,
    gateContinues: true,
    mode: 'overview',
    ...overrides,
  }
}

function straightWalk(frameCount, { intervalMs = 8.33, step = 0.075, startAt = 0 } = {}) {
  const samples = []
  let z = 0
  for (let i = 0; i < frameCount; i += 1) {
    const moving = i >= startAt
    const dz = moving ? step : 0
    z += dz
    samples.push(frame({
      t: i * intervalMs,
      intervalMs,
      pz: z,
      dz,
      keysHeld: moving ? 1 : 0,
      movementIntent: moving,
      physicsSteps: moving ? (i % 2 === 0 ? 0 : 1) : 0,
      physicsAlpha: i % 2 === 0 ? 0.5 : 0,
      shadowInvalidated: moving,
    }))
  }
  return samples
}

describe('summarizeMotion', () => {
  it('returns a neutral report for an empty sample set', () => {
    const report = summarizeMotion([])
    expect(report.frameCount).toBe(0)
    expect(report.anomalies).toEqual([])
  })

  it('reports no anomalies for a uniform 120Hz walk', () => {
    const report = summarizeMotion(straightWalk(120))
    expect(report.longFrameCount).toBe(0)
    expect(report.heldFrameCount).toBe(120)
    expect(report.zeroDisplacementFrames).toBe(0)
    expect(report.quantizedFrames).toBe(0)
    expect(report.doubleStepFrames).toBe(0)
    expect(report.anomalies).toEqual([])
  })

  it('detects frames that miss the display cadence', () => {
    const samples = straightWalk(60)
    samples[30] = { ...samples[30], intervalMs: 16.66, t: samples[30].t + 8.33 }
    const report = summarizeMotion(samples)
    expect(report.longFrameCount).toBe(1)
    expect(report.anomalies.some(text => text.includes('帧间隔'))).toBe(true)
  })

  it('detects 60Hz quantization: held movement with alternating zero/full displacements', () => {
    const samples = straightWalk(60).map((sample, index) => {
      if (!sample.movementIntent) return sample
      // Every other rendered frame gets no world displacement: the classic
      // "position only updates on physics steps, interpolation missing" signature.
      const quantized = index % 2 === 0
      return {
        ...sample,
        dz: quantized ? 0 : sample.dz * 2,
        pz: sample.pz,
      }
    })
    const report = summarizeMotion(samples)
    expect(report.quantizedFrames).toBeGreaterThan(0)
    expect(report.anomalies.some(text => text.includes('量化') || text.includes('插值'))).toBe(true)
  })

  it('detects held movement keys while the rendered character stands still', () => {
    const samples = straightWalk(60)
    for (let i = 20; i < 24; i += 1) {
      samples[i] = { ...samples[i], dz: 0, physicsSteps: 0, physicsAlpha: samples[i - 1]?.physicsAlpha ?? 0 }
    }
    const report = summarizeMotion(samples)
    expect(report.zeroDisplacementFrames).toBeGreaterThanOrEqual(4)
    expect(report.anomalies.some(text => text.includes('静止'))).toBe(true)
  })

  it('counts frames that ran two or more fixed physics steps', () => {
    const samples = straightWalk(60)
    samples[10] = { ...samples[10], physicsSteps: 2 }
    samples[11] = { ...samples[11], physicsSteps: 3 }
    const report = summarizeMotion(samples)
    expect(report.doubleStepFrames).toBe(2)
  })

  it('reports vertical jitter magnitude while moving', () => {
    const samples = straightWalk(60).map((sample, index) => sample.movementIntent
      ? { ...sample, dy: index % 2 === 0 ? 0.02 : -0.02, py: 1.7 + (index % 2 === 0 ? 0.02 : 0) }
      : sample)
    const report = summarizeMotion(samples)
    expect(report.maxAbsVerticalDelta).toBeGreaterThanOrEqual(0.019)
  })

  it('flags frames where the on-demand render gate would stop while movement keys are held', () => {
    const samples = straightWalk(30)
    samples[10] = { ...samples[10], gateContinues: false }
    const report = summarizeMotion(samples)
    expect(report.gateStopWhileHeldFrames).toBe(1)
    expect(report.anomalies.some(text => text.includes('帧调度') || text.includes('停帧'))).toBe(true)
  })
})

describe('extractMotionStalls', () => {
  it('returns per-frame windows around stall runs with velocity and contact details', () => {
    const samples = straightWalk(40)
    for (let i = 15; i < 19; i += 1) {
      samples[i] = {
        ...samples[i],
        dz: 0,
        desiredSpeed: 9,
        actualSpeed: 0,
        wallContacts: 1,
        contacts: 2,
      }
    }

    const report = extractMotionStalls(samples, { context: 2 })

    expect(report.stallFrames).toBe(4)
    expect(report.windows).toHaveLength(1)
    const window = report.windows[0]
    expect(window.startIndex).toBe(15)
    expect(window.length).toBe(4)
    expect(window.frames[0].index).toBe(13)
    expect(window.frames[window.frames.length - 1].index).toBe(20)
    const stalled = window.frames.find(frame => frame.index === 16)
    expect(stalled).toMatchObject({ desiredSpeed: 9, actualSpeed: 0, wallContacts: 1, contacts: 2 })
    expect(stalled.disp).toBe(0)
  })

  it('returns no windows for a healthy uniform walk', () => {
    const report = extractMotionStalls(straightWalk(60))
    expect(report.stallFrames).toBe(0)
    expect(report.windows).toEqual([])
  })
})

describe('MotionProbe ring buffer', () => {
  it('evicts oldest samples once capacity is reached', () => {
    const probe = new MotionProbe({ capacity: 10 })
    for (let i = 0; i < 25; i += 1) probe.record(frame({ t: i * 8.33, pz: i }))
    expect(probe.samples).toHaveLength(10)
    expect(probe.samples[0].pz).toBe(15)
    expect(probe.samples[9].pz).toBe(24)
  })

  it('exposes the same analysis as the pure summarizer', () => {
    const probe = new MotionProbe({ capacity: 100 })
    for (const sample of straightWalk(40)) probe.record(sample)
    expect(probe.analyze().frameCount).toBe(40)
    expect(probe.analyze().anomalies).toEqual([])
  })
})
