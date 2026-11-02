import {
  CAMPUS_PLAN_REFERENCE,
  CAMPUS_AREAS,
  CAMPUS_ROAD_CENTERLINES,
  CAMPUS_BUILDING_FOOTPRINTS,
  mapPixelToWorld,
  mapRectToWorld,
} from '../../../data/campus/campusLayout.js'

// 基于校园平面图的第一版空间场景。当前为示意图数字化，不是测绘级模型。
export function createCampusScene(THREE) {
  const root = new THREE.Group()
  root.name = 'NanchangInstituteCampus'
  const palette = {
    grass: '#648b55', road: '#777b78', roadEdge: '#c5c0ae',
    water: '#70c8c7', waterEdge: '#e0e7d5',
    building: '#c8a66e', buildingSide: '#987b58', roof: '#765d4a',
    sports: '#b8b6a5', tree: '#39764a', trunk: '#765238',
    outline: '#343a35', white: '#eee8d5',
  }
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 1, metalness: 0, flatShading: true, ...extra,
  })
  const mats = Object.fromEntries(Object.entries(palette).map(([k,v]) => [k,mat(v)]))
  const { worldWidth, worldDepth } = CAMPUS_PLAN_REFERENCE

  function addBox(name, x, y, z, w, h, d, material, parent = root) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material)
    mesh.name = name
    mesh.position.set(x,y+h/2,z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  // 校园底板与浅色边界。
  addBox('campus-ground',0,-0.55,0,worldWidth,0.55,worldDepth,mats.grass)
  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(worldWidth,0.08,worldDepth)),
    new THREE.LineBasicMaterial({color:palette.roadEdge}),
  )
  border.position.y=0.02
  root.add(border)

  // 区域矩形。建筑组团只做地块底色，不伪造具体楼栋身份。
  for (const area of CAMPUS_AREAS) {
    if (!area.rect) continue
    const r=mapRectToWorld(area.rect)
    const material = area.type === 'sports' ? mats.sports : mat('#779b65')
    addBox(`area-${area.id}`,r.x,0.005,r.z,r.width,0.035,r.depth,material)
  }

  // 中心湖区：将原图像素多边形转换为地面 Shape。
  const lake = CAMPUS_AREAS.find(a=>a.id==='central-lake')
  if (lake?.polygon?.length) {
    const shape = new THREE.Shape()
    lake.polygon.forEach(([px,py],i)=>{
      const p=mapPixelToWorld(px,py)
      if(i===0) shape.moveTo(p.x,-p.z)
      else shape.lineTo(p.x,-p.z)
    })
    shape.closePath()
    const geometry=new THREE.ShapeGeometry(shape)
    const mesh=new THREE.Mesh(geometry,mats.water)
    mesh.name='campus-central-lake'
    mesh.rotation.x=-Math.PI/2
    mesh.position.y=0.12
    mesh.receiveShadow=true
    root.add(mesh)
    const edgePoints=lake.polygon.map(([px,py])=>{
      const p=mapPixelToWorld(px,py)
      return new THREE.Vector3(p.x,0.15,p.z)
    })
    edgePoints.push(edgePoints[0].clone())
    const edge=new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(edgePoints),
      new THREE.LineBasicMaterial({color:palette.waterEdge}),
    )
    root.add(edge)
  }

  // 道路中心线生成宽路面；线段以圆角曲线连接。
  for (const road of CAMPUS_ROAD_CENTERLINES) {
    const points=road.points.map(([px,py])=>{
      const p=mapPixelToWorld(px,py)
      return new THREE.Vector3(p.x,0.07,p.z)
    })
    const curve=new THREE.CatmullRomCurve3(points)
    const geometry=new THREE.TubeGeometry(curve,Math.max(24,points.length*12),1.15,6,false)
    const mesh=new THREE.Mesh(geometry,mats.road)
    mesh.name=`road-${road.id}`
    mesh.receiveShadow=true
    root.add(mesh)
  }

  // 建筑 footprint：先建立体块占位，楼层高度未知时不虚构楼层数。
  for (const item of CAMPUS_BUILDING_FOOTPRINTS) {
    const r=mapRectToWorld(item.rect)
    const group=new THREE.Group()
    group.name=item.id
    group.position.set(r.x,0.09,r.z)
    group.userData.buildingId=item.id
    group.userData.displayName=item.label
    group.userData.confidence=item.confidence
    const height= item.confidence==='medium' ? 4.2 : 3.2
    const body=new THREE.Mesh(new THREE.BoxGeometry(r.width,height,r.depth),mats.building)
    body.position.y=height/2
    body.castShadow=true
    body.receiveShadow=true
    group.add(body)
    const roof=new THREE.Mesh(new THREE.BoxGeometry(r.width+0.18,0.28,r.depth+0.18),mats.roof)
    roof.position.y=height+0.14
    roof.castShadow=true
    group.add(roof)
    const edges=new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({color:palette.outline}),
    )
    edges.position.copy(body.position)
    group.add(edges)
    root.add(group)
  }

  // 在地块空隙布置少量树木，作为场景尺度与校园绿化占位。
  const treePositions=[
    [202,215],[305,210],[355,280],[190,360],[520,275],[565,355],
    [225,420],[330,430],[485,435],[75,220],[85,260],[570,180],
  ]
  for(const [px,py] of treePositions){
    const p=mapPixelToWorld(px,py)
    const group=new THREE.Group()
    group.position.set(p.x,0,p.z)
    addBox('tree-trunk',0,0,0,0.42,1.5,0.42,mats.trunk,group)
    addBox('tree-crown',0,1.35,0,1.9,1.45,1.8,mats.tree,group)
    root.add(group)
  }

  // 玩家 Sprite：保留原有四帧像素人物动画，兼容漫游控制器。
  const canvas=document.createElement('canvas')
  canvas.width=32; canvas.height=48
  const ctx=canvas.getContext('2d')
  const pixel=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h)}
  const drawFrame=(step=0)=>{
    ctx.clearRect(0,0,32,48)
    pixel(11,2,10,3,'#2c2928'); pixel(8,5,16,12,'#e7b58a')
    pixel(8,5,16,4,'#3c302e'); pixel(6,10,3,8,'#3c302e'); pixel(23,10,3,8,'#3c302e')
    pixel(11,11,3,3,'#292b35'); pixel(19,11,3,3,'#292b35')
    pixel(12,18,8,3,'#f0dfbd'); pixel(8,21,16,13,'#3e7290')
    const swing=step===1?2:step===3?-2:0
    pixel(5,22+swing,3,10,'#e7b58a'); pixel(24,22-swing,3,10,'#e7b58a')
    pixel(9+swing,34,6,10-Math.abs(swing),'#303c58')
    pixel(18-swing,34,6,10-Math.abs(swing),'#303c58')
    pixel(8+swing,44,8,3,'#292624'); pixel(18-swing,44,8,3,'#292624')
  }
  drawFrame()
  const texture=new THREE.CanvasTexture(canvas)
  texture.magFilter=THREE.NearestFilter
  texture.minFilter=THREE.NearestFilter
  texture.colorSpace=THREE.SRGBColorSpace
  const character=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}))
  character.name='PixelExplorerSprite'
  const spawn=mapPixelToWorld(320,370)
  character.position.set(spawn.x,2.1,spawn.z)
  character.scale.set(2.4,3.6,1)
  root.add(character)
  root.userData.playerSprite=character
  let lastFrame=-1
  root.userData.updatePlayerAnimation=(moving,seconds)=>{
    const frame=moving?Math.floor(seconds/0.14)%4:0
    if(frame===lastFrame)return
    lastFrame=frame
    drawFrame(frame)
    texture.needsUpdate=true
  }

  const halfW=worldWidth/2
  const halfD=worldDepth/2
  root.userData.walkableBounds={
    minX:-halfW+2,maxX:halfW-2,minZ:-halfD+2,maxZ:halfD-2,
  }
  root.userData.isVisualPrototype=true
  root.userData.coordinateSystem='campus-plan-pixel-to-world'
  return root
}
