import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createCampusPlayer } from './createCampusPlayer.js'

describe('createCampusPlayer locomotion presentation', () => {
  it('advances gait from one continuous clock at different render cadences', () => {
    const runCadence = (hz) => {
      const player = createCampusPlayer(THREE)
      const update = player.userData.updateAnimation
      update.call(player, false, 0)
      for (let frame = 1; frame <= hz; frame += 1) {
        update.call(player, true, frame / hz, 0, 0, 1, false)
      }
      return player.userData.gaitPhase
    }

    expect(runCadence(30)).toBeCloseTo(runCadence(60), 8)
    expect(runCadence(60)).toBeCloseTo(runCadence(144), 8)
  })

  it('does not let tiny render-position jitter change gait phase', () => {
    const player = createCampusPlayer(THREE)
    const update = player.userData.updateAnimation
    update.call(player, false, 0)
    update.call(player, true, 1 / 60, 0, 0, 1, false)
    const firstPhase = player.userData.gaitPhase
    update.call(player, true, 2 / 60, 0.0002, 0, 1, false)
    const secondPhase = player.userData.gaitPhase
    update.call(player, true, 3 / 60, -0.00015, 0, 1, false)

    expect(secondPhase - firstPhase).toBeCloseTo(player.userData.gaitPhase - secondPhase, 8)
  })

  it('uses distinct nominal cadence for walking and running', () => {
    const walking = createCampusPlayer(THREE)
    const running = createCampusPlayer(THREE)
    walking.userData.updateAnimation.call(walking, false, 0)
    running.userData.updateAnimation.call(running, false, 0)
    walking.userData.updateAnimation.call(walking, true, 1 / 60, 0, 0, 1, false)
    running.userData.updateAnimation.call(running, true, 1 / 60, 0, 0, 1, true)

    expect(running.userData.gaitPhase - 0.85).toBeGreaterThan(walking.userData.gaitPhase - 0.85)
  })

  it('keeps restrained in-place feedback when movement is blocked', () => {
    const player = createCampusPlayer(THREE)
    const update = player.userData.updateAnimation
    update.call(player, false, 0)
    update.call(player, true, 1 / 60, 0, 0, 0.42, false)
    const firstPhase = player.userData.gaitPhase
    update.call(player, true, 2 / 60, 0, 0, 0.42, false)

    expect(player.userData.gaitPhase).toBeGreaterThan(firstPhase)
  })
})
