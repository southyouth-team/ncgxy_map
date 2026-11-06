import { describe, expect, it } from 'vitest'
import { getReferenceImageContainRect, hasMatchingReferenceAspectRatio } from './campusReferenceImage.js'

describe('reference image contain placement', () => {
  it('keeps a matching 2:1 image at the full campus canvas size', () => {
    expect(getReferenceImageContainRect(1600, 800)).toEqual({
      x: 0, y: 0, width: 1000, height: 500, scale: 0.625,
    })
  })

  it('preserves source aspect ratio and centers a taller source image', () => {
    const rect = getReferenceImageContainRect(1200, 900)
    expect(rect.x).toBeCloseTo(166.6666667)
    expect(rect.y).toBe(0)
    expect(rect.width).toBeCloseTo(666.6666667)
    expect(rect.height).toBe(500)
    expect(rect.width / rect.height).toBeCloseTo(1200 / 900)
  })

  it('returns null for invalid dimensions', () => {
    expect(getReferenceImageContainRect(0, 800)).toBeNull()
    expect(getReferenceImageContainRect(100, Number.NaN)).toBeNull()
  })
})


describe('reference image coordinate compatibility', () => {
  it('accepts matching source and dataset aspect ratios', () => {
    expect(hasMatchingReferenceAspectRatio(1600, 800)).toBe(true)
    expect(hasMatchingReferenceAspectRatio(640, 320)).toBe(true)
  })

  it('rejects a changed aspect ratio that requires coordinate recalibration', () => {
    expect(hasMatchingReferenceAspectRatio(1200, 900)).toBe(false)
  })

  it('rejects invalid dimensions and tolerances', () => {
    expect(hasMatchingReferenceAspectRatio(0, 800)).toBe(false)
    expect(hasMatchingReferenceAspectRatio(1000, 500, 1000, 500, -1)).toBe(false)
  })
})
