import { describe, expect, it } from 'vitest'
import { validateIndoorFloor } from './indoorScene.js'

const sample = {
  level: 1, width: 24, depth: 18, wallHeight: 3.4,
  rooms: [{ id: 'classroom-101', name: '教室 101', x: -5, z: 0, width: 8, depth: 6 }],
  doors: [{ wall: 'south', offset: 0, width: 2 }],
}

describe('indoor floor contract', () => {
  it('accepts a configured floor with rooms and an entrance opening', () => {
    expect(validateIndoorFloor(sample)).toEqual([])
  })

  it('rejects invalid floor dimensions', () => {
    expect(validateIndoorFloor({ ...sample, width: 2 })).toContain('楼层 width 必须大于等于 6')
  })

  it('rejects rooms without valid dimensions', () => {
    expect(validateIndoorFloor({ ...sample, rooms: [{ id: 'r1', name: '房间', x: 0, z: 0, width: 0, depth: 4 }] }))
      .toContain('房间 r1 的平面尺寸无效')
  })

  it('requires integer floor levels', () => {
    expect(validateIndoorFloor({ ...sample, level: 1.5 })).toContain('楼层 level 必须是整数')
  })
})
