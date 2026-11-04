import { describe, expect, it } from 'vitest'
import { resolveCampusVisualAsset, validateCampusAssetManifest } from './campusAssetManifest.js'

const manifest = {
  schemaVersion: 1,
  assets: [{
    assetId: 'building-teaching-a',
    name: '教学楼 AI 视觉素材',
    category: 'building',
    sourceType: 'ai_generated',
    status: 'ready',
    files: [
      { viewMode: '2.5d', role: 'primary', mediaType: 'image', format: 'webp', url: '/assets/campus/buildings/teaching-a-iso.webp' },
      { viewMode: '3d', role: 'primary', mediaType: 'glb', format: 'glb', url: '/models/buildings/teaching-a.glb' },
      { viewMode: 'shared', role: 'thumbnail', mediaType: 'image', format: 'webp', url: '/assets/campus/thumbnails/teaching-a.webp' },
    ],
  }],
  bindings: [{ featureId: 'building-001', assetId: 'building-teaching-a' }],
}

describe('campus visual asset manifest', () => {
  it('validates an AI-generated asset with separate 2.5D and 3D variants', () => {
    const report = validateCampusAssetManifest(manifest, ['building-001'])
    expect(report.valid).toBe(true)
    expect(report.summary.readyAssetCount).toBe(1)
  })

  it('resolves exact view variants and does not cross-fallback between 2.5D and 3D', () => {
    expect(resolveCampusVisualAsset(manifest, 'building-001', '2.5d').file.url)
      .toBe('/assets/campus/buildings/teaching-a-iso.webp')
    expect(resolveCampusVisualAsset(manifest, 'building-001', '3d').file.url)
      .toBe('/models/buildings/teaching-a.glb')
    const only2d = structuredClone(manifest)
    only2d.assets[0].files = [only2d.assets[0].files[0]]
    expect(resolveCampusVisualAsset(only2d, 'building-001', '3d').reason).toBe('view-variant-not-found')
  })

  it('uses shared primary files only as an explicit fallback', () => {
    const shared = structuredClone(manifest)
    shared.assets[0].files = [{ viewMode: 'shared', role: 'primary', mediaType: 'image', url: '/assets/campus/shared/building.webp' }]
    expect(resolveCampusVisualAsset(shared, 'building-001', '2.5d').resolved).toBe(true)
  })

  it('rejects duplicate IDs, invalid paths and unknown spatial Feature references', () => {
    const invalid = structuredClone(manifest)
    invalid.assets.push({ ...invalid.assets[0] })
    invalid.assets[0].files[0].url = '/assets/campus/../../private.png'
    invalid.bindings[0].featureId = 'missing-feature'
    const report = validateCampusAssetManifest(invalid, ['building-001'])
    expect(report.valid).toBe(false)
    expect(report.errors.map(error => error.code)).toContain('ASSET_ID_DUPLICATE')
    expect(report.errors.map(error => error.code)).toContain('ASSET_FILE_PATH_INVALID')
    expect(report.errors.map(error => error.code)).toContain('ASSET_BINDING_FEATURE_UNKNOWN')
  })

  it('does not resolve draft or review assets', () => {
    const pending = structuredClone(manifest)
    pending.assets[0].status = 'review'
    expect(resolveCampusVisualAsset(pending, 'building-001', '2.5d').reason).toBe('asset-not-ready')
  })
  it('requires a primary visual file before an asset can be marked ready', () => {
    const thumbnailOnly = structuredClone(manifest)
    thumbnailOnly.assets[0].files = [thumbnailOnly.assets[0].files[2]]
    const report = validateCampusAssetManifest(thumbnailOnly)
    expect(report.errors.map(error => error.code)).toContain('ASSET_READY_WITHOUT_PRIMARY')
  })
})
