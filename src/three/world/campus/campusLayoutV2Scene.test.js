import { describe, expect, it } from 'vitest'
import { CAMPUS_LAYOUT_V2 } from '../../../data/campus/campusLayoutV2.js'
import { campusLayoutV2ToSceneFeatures } from './campusLayoutV2Scene.js'

function createDocument() {
  const documentData = JSON.parse(JSON.stringify(CAMPUS_LAYOUT_V2))
  documentData.coordinateSystem.referenceImage.width = 640
  documentData.coordinateSystem.referenceImage.height = 480
  return documentData
}

describe('campusLayoutV2Scene', () => {
  it('refuses to create scene features before calibration', () => {
    expect(() => campusLayoutV2ToSceneFeatures(createDocument())).toThrow('尚未完成坐标配准')
  })

  it('converts calibrated pixel geometry into world coordinates', () => {
    const documentData = createDocument()
    documentData.coordinateSystem.calibrationStatus = 'calibrated'
    documentData.calibration = { imageWidth: 640, imageHeight: 480, worldWidth: 160 }
    documentData.features.roads.push({
      id: 'main-road', type: 'road', name: '主干道', status: 'verified', confidence: 'high',
      sourceRefs: ['survey'], geometry: { type: 'LineString', coordinates: [[0, 240], [640, 240]] },
    })
    const features = campusLayoutV2ToSceneFeatures(documentData)
    expect(features).toHaveLength(1)
    expect(features[0].coordinates).toEqual([{ x: -80, z: 0 }, { x: 80, z: 0 }])
  })

  it('rejects geometries outside the image before conversion', () => {
    const documentData = createDocument()
    documentData.coordinateSystem.calibrationStatus = 'calibrated'
    documentData.calibration = { imageWidth: 640, imageHeight: 480, worldWidth: 160 }
    documentData.features.entrances.push({
      id: 'bad-gate', type: 'entrance', status: 'draft', confidence: 'low',
      sourceRefs: ['survey'], geometry: { type: 'Point', coordinates: [700, 20] },
    })
    expect(() => campusLayoutV2ToSceneFeatures(documentData)).toThrow('V2 校园数据校验失败')
  })
})
