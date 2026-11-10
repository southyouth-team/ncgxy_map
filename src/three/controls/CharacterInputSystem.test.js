import { afterEach, describe, expect, it, vi } from 'vitest'
import { CharacterInputSystem } from './CharacterInputSystem.js'

const originalWindow = globalThis.window
const originalDocument = globalThis.document

function installBrowserEventTargets() {
  const windowTarget = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const documentTarget = {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('window', windowTarget)
  vi.stubGlobal('document', documentTarget)
  return { windowTarget, documentTarget }
}

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalWindow !== undefined) vi.stubGlobal('window', originalWindow)
  if (originalDocument !== undefined) vi.stubGlobal('document', originalDocument)
})

describe('CharacterInputSystem', () => {
  it('owns capture-phase keyboard listeners and attaches idempotently', () => {
    const { windowTarget, documentTarget } = installBrowserEventTargets()
    const input = new CharacterInputSystem()

    expect(input.attach()).toBe(true)
    expect(input.attach()).toBe(false)
    expect(windowTarget.addEventListener).toHaveBeenCalledWith('keydown', input.handleKeyDown, true)
    expect(windowTarget.addEventListener).toHaveBeenCalledWith('keyup', input.handleKeyUp, true)
    expect(documentTarget.addEventListener).toHaveBeenCalledWith('visibilitychange', input.handleVisibilityChange)

    expect(input.dispose()).toBe(true)
    expect(input.dispose()).toBe(false)
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith('keydown', input.handleKeyDown, true)
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith('keyup', input.handleKeyUp, true)
  })

  it('publishes held movement state and only emits the jump edge once per press', () => {
    const onJump = vi.fn()
    const onInputChange = vi.fn()
    const input = new CharacterInputSystem({ onJump, onInputChange })
    const event = { code: 'KeyW', key: 'w', target: { tagName: 'CANVAS' }, preventDefault: vi.fn() }

    input.handleKeyDown(event)
    input.handleKeyDown({ ...event, repeat: true })
    expect(input.keys.has('w')).toBe(true)
    expect(onInputChange).toHaveBeenCalledTimes(2)

    input.handleKeyDown({ ...event, code: 'Space', key: ' ', repeat: false })
    input.handleKeyDown({ ...event, code: 'Space', key: ' ', repeat: true })
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('ignores editable controls and clears held keys on focus loss', () => {
    const onClearInput = vi.fn()
    const input = new CharacterInputSystem({ onClearInput })
    const preventDefault = vi.fn()

    input.handleKeyDown({ code: 'KeyW', key: 'w', target: { tagName: 'INPUT' }, preventDefault })
    expect(input.keys.size).toBe(0)
    expect(preventDefault).not.toHaveBeenCalled()

    input.handleKeyDown({ code: 'KeyW', key: 'w', target: { tagName: 'CANVAS' }, preventDefault })
    input.handleWindowBlur()
    expect(input.keys.size).toBe(0)
    expect(onClearInput).toHaveBeenCalledOnce()
  })
})
