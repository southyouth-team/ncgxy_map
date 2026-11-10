function normalizeInputKey(eventOrKey) {
  const event = typeof eventOrKey === 'object' && eventOrKey !== null ? eventOrKey : null
  const code = String(event?.code || '')
  const codeMap = {
    KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyR: 'r',
    ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
    ShiftLeft: 'shift', ShiftRight: 'shift', Space: 'space',
  }
  if (codeMap[code]) return codeMap[code]
  const key = String(event ? event.key : eventOrKey || '').toLowerCase()
  return key === ' ' || key === 'spacebar' ? 'space' : key
}

/**
 * Owns physical keyboard state and browser event lifecycle.
 * It reports semantic input edges; locomotion and physics remain outside.
 */
export class CharacterInputSystem {
  constructor({ onJump, onReset, onInputChange, onClearInput } = {}) {
    this.keys = new Set()
    this.onJump = onJump
    this.onReset = onReset
    this.onInputChange = onInputChange
    this.onClearInput = onClearInput
    this.attached = false

    this.handleKeyDown = event => {
      const key = normalizeInputKey(event)
      const target = event.target
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return
      if (key === 'r') {
        this.onReset?.()
        event.preventDefault?.()
        return
      }
      if (key === 'space') {
        if (!event.repeat) this.onJump?.()
        this.onInputChange?.()
        event.preventDefault?.()
        return
      }
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) return
      this.keys.add(key)
      this.onInputChange?.()
      event.preventDefault?.()
    }
    this.handleKeyUp = event => {
      const key = normalizeInputKey(event)
      if (this.keys.delete(key)) this.onInputChange?.()
    }
    this.clearHeldInput = () => {
      this.keys.clear()
      this.onClearInput?.()
      this.onInputChange?.()
    }
    this.handleWindowBlur = this.clearHeldInput
    this.handleWindowFocus = () => this.onInputChange?.()
    this.handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this.clearHeldInput()
    }
  }

  attach() {
    if (this.attached) return false
    this.attached = true
    window.addEventListener('keydown', this.handleKeyDown, true)
    window.addEventListener('keyup', this.handleKeyUp, true)
    window.addEventListener('blur', this.handleWindowBlur)
    window.addEventListener('focus', this.handleWindowFocus)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    return true
  }

  dispose() {
    if (!this.attached) return false
    this.attached = false
    window.removeEventListener('keydown', this.handleKeyDown, true)
    window.removeEventListener('keyup', this.handleKeyUp, true)
    window.removeEventListener('blur', this.handleWindowBlur)
    window.removeEventListener('focus', this.handleWindowFocus)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.clearHeldInput()
    return true
  }
}
