import { describe, expect, it } from 'vitest'
import {
  BUILDING_TEMPLATES,
  createSceneDocument,
  createSceneObject,
  validateSceneDocument,
} from './sceneDocument.js'

describe('scene document', () => {
  it('creates a versioned campus-local document with default layer', () => {
    const document = createSceneDocument({ id: 'ncgxy-main', campusId: 'ncgxy' })
    expect(document.schemaVersion).toBe(1)
    expect(document.coordinateMapping).toEqual({
      groundPlane: 'XZ',
      verticalAxis: 'Y',
      unit: 'scene-unit',
    })
    expect(document.layers[0].id).toBe('default')
    expect(validateSceneDocument(document)).toEqual([])
  })

  it('creates template-first building objects with editable business properties', () => {
    const building = createSceneObject('building', {
      id: 'building-1',
      templateId: BUILDING_TEMPLATES[0].id,
      transform: { position: [10, 0, 20] },
    })
    expect(building.properties).toMatchObject({
      floors: 3,
      floorHeight: 3.3,
      footprint: [16, 12],
      constructionMode: 'template',
    })
    expect(building.transform.position).toEqual([10, 0, 20])
    expect(building.transform.scale).toEqual([1, 1, 1])
  })

  it('supports block-composed buildings without a template', () => {
    const building = createSceneObject('building', {
      properties: { constructionMode: 'blocks', floors: 5, modules: ['base', 'floor', 'roof'] },
    })
    expect(building.properties).toMatchObject({
      constructionMode: 'blocks',
      floors: 5,
      modules: ['base', 'floor', 'roof'],
    })
  })

  it('rejects unsupported object types and malformed transforms', () => {
    expect(() => createSceneObject('unknown')).toThrow('不支持的场景对象类型')
    const document = createSceneDocument()
    document.objects.push({
      id: 'bad-object',
      type: 'building',
      transform: { position: [0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
    })
    expect(validateSceneDocument(document)).toContain('对象 bad-object 的 transform.position 无效')
  })

  it('detects duplicate object ids', () => {
    const document = createSceneDocument()
    document.objects = [
      createSceneObject('water', { id: 'same-id' }),
      createSceneObject('terrain', { id: 'same-id' }),
    ]
    expect(validateSceneDocument(document)).toContain('场景对象 ID 缺失或重复')
  })
})
