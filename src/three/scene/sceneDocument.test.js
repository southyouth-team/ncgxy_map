import { describe, expect, it } from 'vitest'
import {
  BUILDING_TEMPLATES,
  createSceneDocument,
  createSceneObject,
  validateSceneDocument,
} from './sceneDocument.js'

describe('scene document v2', () => {
  it('creates a map-scoped campus-local document', () => {
    const document = createSceneDocument({ id: 'ncgxy-main', campusId: 'ncgxy', mapId: 'map-1' })
    expect(document.schemaVersion).toBe(2)
    expect(document.mapId).toBe('map-1')
    expect(document.coordinateMapping).toEqual({ groundPlane: 'XZ', verticalAxis: 'Y', unit: 'scene-unit' })
    expect(document.layers[0].id).toBe('default')
    expect(validateSceneDocument(document)).toEqual([])
  })

  it('creates template-first buildings without duplicating GIS footprint or planar transform', () => {
    const building = createSceneObject('building', {
      id: 'building-1', featureId: 'feature-1', templateId: BUILDING_TEMPLATES[0].id,
    })
    expect(building).toMatchObject({
      featureId: 'feature-1',
      templateId: 'academic-building',
      properties: { floors: 3, floorHeight: 3.3, constructionMode: 'template' },
      elevation: 0,
      modelTransform: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    })
    expect(building).not.toHaveProperty('transform.position')
    expect(building.properties).not.toHaveProperty('footprint')
  })

  it('supports block-composed buildings', () => {
    const building = createSceneObject('building', {
      featureId: 'feature-2',
      properties: { constructionMode: 'blocks', floors: 5, modules: ['base', 'floor', 'roof'] },
    })
    expect(building.properties).toMatchObject({
      constructionMode: 'blocks', floors: 5, modules: ['base', 'floor', 'roof'],
    })
  })

  it('allows unbound objects only as explicit editor drafts', () => {
    const document = createSceneDocument({ mapId: 'map-1' })
    document.objects.push(createSceneObject('building', { id: 'draft-1' }))
    expect(validateSceneDocument(document)).toContain('对象 draft-1 尚未关联 GIS Feature')
    expect(validateSceneDocument(document, { allowDrafts: true })).toEqual([])
  })

  it('rejects unsupported types, invalid model transforms and missing map scope', () => {
    expect(() => createSceneObject('unknown')).toThrow('不支持的场景对象类型')
    const document = createSceneDocument()
    document.objects.push({
      id: 'bad-object', type: 'building', featureId: 'feature-1',
      elevation: 0,
      modelTransform: { rotation: [0, 0], scale: [1, 1, 1] },
    })
    expect(validateSceneDocument(document)).toContain('场景文档必须关联 mapId')
    expect(validateSceneDocument({ ...document, mapId: 'map-1' }))
      .toContain('对象 bad-object 的 modelTransform.rotation 无效')
  })

  it('rejects duplicate scene ids and duplicate primary feature bindings', () => {
    const document = createSceneDocument({ mapId: 'map-1' })
    document.objects = [
      createSceneObject('water', { id: 'same-id', featureId: 'feature-1' }),
      createSceneObject('terrain', { id: 'same-id', featureId: 'feature-1' }),
    ]
    const errors = validateSceneDocument(document)
    expect(errors).toContain('场景对象 ID 缺失或重复')
    expect(errors).toContain('GIS Feature feature-1 被多个主场景对象重复关联')
  })
})
