import { campusBuildings } from './campusData.js'

export function createCampusScene(THREE) {
  const root = new THREE.Group()
  root.name = 'NanchangInstituteCampus'
  const mat = (color, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness })
  const grass = mat('#81977a')
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), grass)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.12
  ground.receiveShadow = true
  root.add(ground)

  const roadMat = mat('#626d6b')
  const pathMat = mat('#c4bda8')
  const road = (x, z, w, d, material = roadMat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), material)
    mesh.position.set(x, 0, z)
    mesh.receiveShadow = true
    root.add(mesh)
  }
  road(0, 0, 12, 150)
  road(0, 0, 150, 10)
  road(-36, 0, 5, 132, pathMat)
  road(36, 0, 5, 132, pathMat)
  road(0, -35, 132, 4, pathMat)
  road(0, 35, 132, 4, pathMat)

  const treeTrunk = mat('#72533c')
  const treeTop = mat('#54775b')
  for (let x = -68; x <= 68; x += 13) {
    for (let z = -65; z <= 65; z += 14) {
      if ((Math.abs(x) < 10 && Math.abs(z) < 70) || (Math.abs(z) < 8 && Math.abs(x) < 70)) continue
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 7), treeTrunk)
      trunk.position.set(x, 1.2, z)
      trunk.castShadow = true
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), treeTop)
      crown.position.set(x, 3.1, z)
      crown.scale.set(1, 1.15, 1)
      crown.castShadow = true
      root.add(trunk, crown)
    }
  }

  const buildingMaterials = [
    mat('#d8d0bd'), mat('#c4bca9'), mat('#b9c4bd'), mat('#d7c4a1'),
  ]
  campusBuildings.forEach((building, index) => {
    const group = new THREE.Group()
    group.position.set(building.x, 0, building.z)
    const width = building.width
    const depth = building.depth
    const height = building.height
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), buildingMaterials[index % buildingMaterials.length])
    body.position.y = height / 2
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.8, 0.65, depth + 0.8), mat('#6b7772'))
    roof.position.y = height + 0.3
    roof.castShadow = true
    group.add(roof)

    const floors = Math.max(2, Math.floor(height / 3.2))
    const windowMat = new THREE.MeshStandardMaterial({ color: '#59777a', roughness: 0.35, metalness: 0.12 })
    for (let floor = 0; floor < floors; floor++) {
      const y = 1.4 + floor * (height / floors)
      for (let i = 0; i < Math.floor(width / 2.6); i++) {
        const x = -width / 2 + 1.4 + i * 2.6
        const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 0.08), windowMat)
        windowMesh.position.set(x, y, depth / 2 + 0.05)
        group.add(windowMesh)
      }
    }
    const labelCanvas = document.createElement('canvas')
    labelCanvas.width = 512
    labelCanvas.height = 128
    const ctx = labelCanvas.getContext('2d')
    ctx.fillStyle = '#233337'
    ctx.fillRect(0, 0, 512, 128)
    ctx.fillStyle = '#f0e5c9'
    ctx.font = 'bold 38px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(building.name, 256, 64)
    const texture = new THREE.CanvasTexture(labelCanvas)
    const label = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width, 18), 4.5), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }))
    label.position.set(0, Math.min(height - 1, 9), depth / 2 + 0.12)
    group.add(label)
    root.add(group)
  })

  const plaza = new THREE.Mesh(new THREE.CircleGeometry(10, 48), pathMat)
  plaza.rotation.x = -Math.PI / 2
  plaza.position.set(0, 0.08, 0)
  root.add(plaza)

  const markerMat = new THREE.MeshStandardMaterial({ color: '#d7bd82', emissive: '#5b4520', emissiveIntensity: 0.4 })
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 24), markerMat)
  marker.position.set(0, 0.18, 0)
  root.add(marker)

  root.userData.walkableBounds = { minX: -78, maxX: 78, minZ: -78, maxZ: 78 }
  return root
}
