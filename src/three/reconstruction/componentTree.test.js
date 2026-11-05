import { describe, expect, it } from 'vitest'
import { duplicateComponentSubtree } from './componentTree.js'

const makeId = (() => { let index = 0; return () => 'copy-' + (++index) })()

describe('component tree operations', () => {
  it('duplicates a complete subtree and remaps internal parent references', () => {
    const source = [
      { id: 'root-a', parent: null, name: '主体', dimensions: { width: 4 }, transform: { position: [0, 0, 0] } },
      { id: 'child-a', parent: 'root-a', name: '左塔', transform: { position: [-1, 1, 0] } },
      { id: 'grandchild-a', parent: 'child-a', name: '塔顶' },
      { id: 'root-b', parent: null, name: '另一个根' },
    ]
    const result = duplicateComponentSubtree(source, 'root-a', makeId)
    expect(result.components.map(node => node.id)).toEqual(['copy-1', 'copy-2', 'copy-3'])
    expect(result.components[0].parent).toBeNull()
    expect(result.components[1].parent).toBe('copy-1')
    expect(result.components[2].parent).toBe('copy-2')
    expect(result.components[0].transform.position[0]).toBeCloseTo(0.6)
    expect(result.components[1].transform.position).toEqual([-1, 1, 0])
    expect(result.tree.map(node => node.id)).toEqual(['root-a', 'child-a', 'grandchild-a', 'root-b', 'copy-1', 'copy-2', 'copy-3'])
    expect(source).toHaveLength(4)
  })

  it('preserves the original external parent of a copied subtree root', () => {
    const source = [{ id: 'parent', parent: null }, { id: 'child', parent: 'parent' }, { id: 'leaf', parent: 'child' }]
    let index = 0
    const result = duplicateComponentSubtree(source, 'child', () => 'external-copy-' + (++index))
    expect(result.components[0].parent).toBe('parent')
    expect(result.components[1].parent).toBe(result.rootId)
  })

  it('rejects unknown roots and duplicate generated ids', () => {
    expect(() => duplicateComponentSubtree([], 'missing', makeId)).toThrow('找不到')
    expect(() => duplicateComponentSubtree([{ id: 'root', parent: null }], 'root', () => 'same')).toThrow('重复')
  })
})
