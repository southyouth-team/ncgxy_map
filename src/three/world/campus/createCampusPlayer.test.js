import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createCampusPlayer } from './createCampusPlayer.js'

describe('createCampusPlayer locomotion presentation', () => {
  it('advances the gait phase from rendered travel distance, independent of render cadence', () => {
    const player = createCampusPlayer(THREE)
    const update = player.userData.updateAnimation

    update.call(player, false, 0)
    update.call(player, true, 1, 0.2, 0, 1, false)
    const firstPhase = player.userData.gaitPhase
    update.call(player, true, 1.01, 0.2, 0, 1, false)
    const secondPhase = player.userData.gaitPhase

    expect(secondPhase - firstPhase).toBeCloseTo(0.2 * Math.PI * 2 / 3.2)
  })

  it('uses a longer stride reference for running than walking', () => {
    const walking = createCampusPlayer(THREE)
    const running = createCampusPlayer(THREE)

    walking.userData.updateAnimation.call(walking, false, 0)
    running.userData.updateAnimation.call(running, false, 0)
    walking.userData.updateAnimation.call(walking, true, 1, 0.5, 0, 1, false)
    running.userData.updateAnimation.call(running, true, 1, 0.5, 0, 1, true)

    expect(walking.userData.gaitPhase - 0.85).toBeGreaterThan(running.userData.gaitPhase - 0.85)
  })

  it('keeps restrained in-place gait feedback when movement is blocked', () => {
    const player = createCampusPlayer(THREE)
    const update = player.userData.updateAnimation

    update.call(player, false, 0)
    update.call(player, true, 1, 0, 0, 0.42, false)
    const firstPhase = player.userData.gaitPhase
    update.call(player, true, 1 + 1 / 60, 0, 0, 0.42, false)

    expect(player.userData.gaitPhase).toBeGreaterThan(firstPhase)
  })
})
