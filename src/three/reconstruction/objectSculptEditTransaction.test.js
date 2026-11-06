import { describe, expect, it, vi } from 'vitest'
import { createObjectSculptEditTransaction } from './objectSculptEditTransaction.js'

describe('createObjectSculptEditTransaction', () => {
  it('commits a validated candidate without mutating the source spec', () => {
    const source = { componentTree: [{ id: 'wall', dimensions: { width: 4 } }] }
    const validate = vi.fn(candidate => {
      expect(candidate.componentTree[0].dimensions.width).toBe(6)
    })

    const result = createObjectSculptEditTransaction(source, candidate => {
      candidate.componentTree[0].dimensions.width = 6
    }, validate)

    expect(result.changed).toBe(true)
    expect(result.previous.componentTree[0].dimensions.width).toBe(4)
    expect(result.spec.componentTree[0].dimensions.width).toBe(6)
    expect(source.componentTree[0].dimensions.width).toBe(4)
    expect(validate).toHaveBeenCalledTimes(1)
  })

  it('does not commit or mutate when complete-spec validation rejects the candidate', () => {
    const source = { componentTree: [{ id: 'wall', dimensions: { width: 4 } }] }
    const validate = vi.fn(() => { throw new RangeError('cutout 越界') })

    expect(() => createObjectSculptEditTransaction(source, candidate => {
      candidate.componentTree[0].dimensions.width = 1
    }, validate)).toThrow('cutout 越界')
    expect(source.componentTree[0].dimensions.width).toBe(4)
    expect(validate).toHaveBeenCalledTimes(1)
  })

  it('skips validation and history commits for no-op edits', () => {
    const source = { componentTree: [{ id: 'wall', dimensions: { width: 4 } }] }
    const validate = vi.fn()

    const result = createObjectSculptEditTransaction(source, candidate => {
      candidate.componentTree[0].dimensions.width = 4
    }, validate)

    expect(result.changed).toBe(false)
    expect(validate).not.toHaveBeenCalled()
  })

  it('rejects invalid transaction contracts', () => {
    expect(() => createObjectSculptEditTransaction(null, () => {}, () => {})).toThrow('ObjectSculptSpec')
    expect(() => createObjectSculptEditTransaction({}, null, () => {})).toThrow('edit')
    expect(() => createObjectSculptEditTransaction({}, () => {}, null)).toThrow('validate')
  })
})
