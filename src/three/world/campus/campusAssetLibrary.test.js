import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { CAMPUS_BUILDING_ASSET_CATALOG, CAMPUS_BUILDING_TEMPLATES, drawPixelBuildingPreview, selectBuildingEntranceEdge, getBuildingFloorLayout, createGableRoofVertices, getGableRoofLayout, normalizeBuildingParameters, validateBuildingFootprint, getFacadeWindowPositions, createPixelBuilding } from './campusAssetLibrary.js'

describe('shared campus building assets', () => {
  it('creates a ridge-based gable roof for a convex rectangular footprint', () => {
    const vertices = createGableRoofVertices([
      { x: -4, y: -2 }, { x: 4, y: -2 }, { x: 4, y: 2 }, { x: -4, y: 2 },
    ], 4, 1.2)
    expect(vertices).toHaveLength(36)
    const ys = vertices.filter((value, index) => index % 3 === 1)
    expect(Math.max(...ys)).toBeCloseTo(5.2, 6)
    expect(Math.min(...ys)).toBe(4)
  })
  it('falls back for unsupported concave or non-quadrilateral roof outlines', () => {
    expect(createGableRoofVertices([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 4 },
    ], 4, 1)).toBeNull()
    expect(createGableRoofVertices([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], 4, 1)).toBeNull()
  })

  it('uses one ridge layout for roof surfaces and ridge decoration', () => {
    const points = [
      { x: -5, y: -2 }, { x: 5, y: -2 }, { x: 4, y: 2 }, { x: -4, y: 2 },
    ]
    const layout = getGableRoofLayout(points)
    const vertices = createGableRoofVertices(points, 3, 1)
    expect(layout).not.toBeNull()
    expect(vertices).toHaveLength(36)
    const ridgeVertices = vertices.filter((value, index) => index % 3 === 1 && value === 4)
    expect(ridgeVertices.length).toBeGreaterThan(0)
    expect(layout.ridgeStart).toEqual({
      x: (layout.contour[3].x + layout.contour[0].x) / 2,
      y: (layout.contour[3].y + layout.contour[0].y) / 2,
    })
    expect(getGableRoofLayout([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 4 },
    ])).toBeNull()
  })

  it('calculates consistent floor heights, window levels and floor bands', () => {
    const layout = getBuildingFloorLayout(12, 4, 0.8)
    expect(layout.floors).toBe(4)
    expect(layout.floorHeight).toBe(3)
    layout.windowCenters.forEach((center, index) => expect(center).toBeCloseTo(1.68 + index * 3, 8))
    expect(layout.bandHeights).toEqual([3, 6, 9])
    expect(layout.windowHeight).toBeLessThanOrEqual(1.26)
  })
  it('rejects non-positive building height', () => {
    expect(() => getBuildingFloorLayout(0, 3)).toThrow('建筑总高度必须大于 0')
  })

  it('normalizes invalid building parameters into safe geometry ranges', () => {
    const normalized = normalizeBuildingParameters(CAMPUS_BUILDING_TEMPLATES['教学楼'], {
      height: -20,
      floors: 30,
      roofRise: 999,
      windowDensity: 100,
      windowWidth: 0,
      windowHeight: -2,
      doorWidth: 100,
      roofStyle: 'unsupported',
    })
    expect(normalized.height).toBe(1)
    expect(normalized.floors).toBe(1)
    expect(normalized.roofRise).toBeCloseTo(0.6)
    expect(normalized.windowDensity).toBe(3)
    expect(normalized.windowWidth).toBe(0.28)
    expect(normalized.windowHeight).toBe(0.2)
    expect(normalized.doorWidth).toBe(5)
    expect(normalized.roofStyle).toBe('pitched')
  })
  it('preserves template defaults when overrides are empty or non-numeric', () => {
    const preset = CAMPUS_BUILDING_TEMPLATES['图书馆']
    const normalized = normalizeBuildingParameters(preset, { height: '', floors: 'invalid', roofRise: null })
    expect(normalized.height).toBe(preset.height)
    expect(normalized.floors).toBe(preset.floors)
    expect(normalized.roofRise).toBe(preset.roofRise)
    expect(normalized.roofStyle).toBe('glass')
  })

  it('uses a configured entrance edge and falls back to the longest edge', () => {
    const edges = [{ index: 0, length: 4 }, { index: 1, length: 9 }, { index: 2, length: 6 }]
    expect(selectBuildingEntranceEdge(edges, 2)).toBe(edges[2])
    expect(selectBuildingEntranceEdge(edges, 99)).toBe(edges[1])
    expect(selectBuildingEntranceEdge(edges, null)).toBe(edges[1])
    expect(selectBuildingEntranceEdge([])).toBeNull()
  })
  it('validates building footprints and detects self-intersections', () => {
    expect(validateBuildingFootprint([[0, 0], [8, 0], [8, 5], [0, 5]]).valid).toBe(true)
    expect(validateBuildingFootprint([[0, 0], [4, 4], [0, 4], [4, 0]]).errors).toContain('建筑轮廓存在自相交边线')
    expect(validateBuildingFootprint([[0, 0], [1, 1], [2, 2]]).errors).toContain('建筑轮廓面积为零或过小')
    expect(validateBuildingFootprint([[0, 0], [0, 0], [0, 0]]).valid).toBe(false)
  })


  it('rebuilds concave building walls, facade and roof from the exact polygon footprint', () => {
    const sharedMaterial = new THREE.MeshStandardMaterial({ color: '#b9c6c2' })
    const materials = new Proxy({}, { get: () => sharedMaterial })
    const shape = new THREE.Shape([
      new THREE.Vector2(-6, -5),
      new THREE.Vector2(6, -5),
      new THREE.Vector2(6, 1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(1, 5),
      new THREE.Vector2(-6, 5),
    ])
    const building = createPixelBuilding(THREE, {
      footprint: shape,
      width: 12,
      depth: 10,
      height: 7.2,
      floors: 2,
      template: '教学楼',
      materials,
      label: 'polygon-building-test',
    })
    const roof = building.children.find(child => child.userData.objectType === 'building-roof')
    expect(roof).toBeTruthy()
    expect(roof.userData.roofStyle).toBe('flat')
    roof.geometry.computeBoundingBox()
    expect(roof.geometry.boundingBox.min.x).toBeCloseTo(-6, 5)
    expect(roof.geometry.boundingBox.max.x).toBeCloseTo(6, 5)
    expect(roof.geometry.boundingBox.min.z).toBeCloseTo(-5, 5)
    expect(roof.geometry.boundingBox.max.z).toBeCloseTo(5, 5)
    expect(building.children.filter(child => child.userData.objectType === 'building-cornice')).toHaveLength(6)
    expect(building.userData.floorCount).toBe(2)
  })

  it('keeps facade windows inside short edges and prevents overlap at high density', () => {
    expect(getFacadeWindowPositions(1.1, 0.6, 3)).toEqual([])
    const positions = getFacadeWindowPositions(12, 0.6, 3)
    expect(positions.length).toBeGreaterThan(0)
    positions.slice(1).forEach((position, index) => {
      expect(position - positions[index]).toBeGreaterThanOrEqual(0.92 - 1e-8)
    })
  })
  it('reserves the entrance opening when placing facade windows', () => {
    const positions = getFacadeWindowPositions(12, 0.6, 1, 6, 1.1)
    expect(positions.every(position => Math.abs(position - 6) >= 1.46)).toBe(true)
  })

  it('exposes one editor asset for every 3D building template', () => {
    expect(CAMPUS_BUILDING_ASSET_CATALOG.map(item => item.template)).toEqual(Object.keys(CAMPUS_BUILDING_TEMPLATES))
    expect(CAMPUS_BUILDING_ASSET_CATALOG.every(item => item.id.startsWith('building-'))).toBe(true)
  })

  it('draws a pixel preview using the selected building template', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    }
    Object.defineProperty(context, 'fillStyle', { set: vi.fn() })
    Object.defineProperty(context, 'strokeStyle', { set: vi.fn() })
    Object.defineProperty(context, 'lineWidth', { set: vi.fn() })

    drawPixelBuildingPreview(context, {
      x: 2, y: 3, width: 5, height: 4, tileSize: 16, template: '图书馆', selected: true,
    })

    expect(context.save).toHaveBeenCalledOnce()
    expect(context.fillRect).toHaveBeenCalled()
    expect(context.strokeRect).toHaveBeenCalledOnce()
    expect(context.restore).toHaveBeenCalledOnce()
  })

  it('rejects invalid canvas geometry', () => {
    expect(() => drawPixelBuildingPreview({}, { x: 0, y: 0, width: 0, height: 4, tileSize: 16 })).toThrow('建筑二维预览参数无效')
  })
})
