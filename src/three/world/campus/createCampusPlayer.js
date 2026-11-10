// 低多边形像素风校园角色：使用真实 3D 体块和关节动画，不再依赖始终朝向相机的 Sprite。
export function createCampusPlayer(THREE, options = {}) {
  const root = new THREE.Group()
  root.name = 'PixelExplorerSprite'
  root.userData.objectType = 'player-character'
  root.userData.displayName = '校园探索者'

  const material = (color, roughness = 1) => new THREE.MeshStandardMaterial({
    color,
    roughness,
    flatShading: true,
  })
  const materials = {
    skin: material('#e9b98e'),
    skinShade: material('#c98f69'),
    hair: material('#49382f'),
    hairLight: material('#69503c'),
    shirt: material('#477da5'),
    shirtLight: material('#6c9fc0'),
    shirtShade: material('#315b7c'),
    pants: material('#394653'),
    pantsLight: material('#536170'),
    shoes: material('#e8dfca'),
    sole: material('#8d8270'),
    backpack: material('#b87943'),
    backpackShade: material('#81502f'),
    eye: material('#282c30'),
  }

  const makePart = (name, size, mat, parent, position, castShadow = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat)
    mesh.name = name
    mesh.position.set(...position)
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  // 双脚着地的角色根节点；所有肢体围绕关节转动。
  const body = new THREE.Group()
  body.name = 'player-body'
  root.add(body)

  // 腿部关节：髋部作为旋转中心，鞋子独立成型。
  const leftLeg = new THREE.Group()
  leftLeg.name = 'player-left-leg'
  leftLeg.position.set(-0.17, 0.79, 0)
  body.add(leftLeg)
  makePart('player-left-trouser', [0.25, 0.62, 0.29], materials.pants, leftLeg, [0, -0.31, 0])
  makePart('player-left-trouser-highlight', [0.07, 0.48, 0.018], materials.pantsLight, leftLeg, [-0.055, -0.31, 0.153], false)
  makePart('player-left-shoe', [0.29, 0.16, 0.39], materials.shoes, leftLeg, [0, -0.66, 0.055])
  makePart('player-left-shoe-sole', [0.30, 0.055, 0.40], materials.sole, leftLeg, [0, -0.735, 0.055])

  const rightLeg = new THREE.Group()
  rightLeg.name = 'player-right-leg'
  rightLeg.position.set(0.17, 0.79, 0)
  body.add(rightLeg)
  makePart('player-right-trouser', [0.25, 0.62, 0.29], materials.pants, rightLeg, [0, -0.31, 0])
  makePart('player-right-trouser-highlight', [0.07, 0.48, 0.018], materials.pantsLight, rightLeg, [0.055, -0.31, 0.153], false)
  makePart('player-right-shoe', [0.29, 0.16, 0.39], materials.shoes, rightLeg, [0, -0.66, 0.055])
  makePart('player-right-shoe-sole', [0.30, 0.055, 0.40], materials.sole, rightLeg, [0, -0.735, 0.055])

  // 躯干与背包形成清晰的前后厚度，侧面不再退化成一张平面。
  makePart('player-torso', [0.68, 0.76, 0.43], materials.shirt, body, [0, 1.18, 0])
  makePart('player-shirt-front-panel', [0.42, 0.52, 0.025], materials.shirtLight, body, [0, 1.2, 0.229], false)
  makePart('player-shirt-hem', [0.7, 0.12, 0.45], materials.shirtShade, body, [0, 0.83, 0])
  makePart('player-backpack', [0.48, 0.55, 0.22], materials.backpack, body, [0, 1.25, -0.29])
  makePart('player-backpack-pocket', [0.32, 0.22, 0.035], materials.backpackShade, body, [0, 1.12, -0.415])

  // 手臂从肩部摆动，与对侧腿部反相。
  const leftArm = new THREE.Group()
  leftArm.name = 'player-left-arm'
  leftArm.position.set(-0.42, 1.45, 0)
  body.add(leftArm)
  makePart('player-left-sleeve', [0.25, 0.38, 0.31], materials.shirtShade, leftArm, [0, -0.17, 0])
  makePart('player-left-forearm', [0.19, 0.34, 0.22], materials.skin, leftArm, [0, -0.49, 0.015])
  makePart('player-left-hand', [0.19, 0.16, 0.20], materials.skinShade, leftArm, [0, -0.72, 0.035])

  const rightArm = new THREE.Group()
  rightArm.name = 'player-right-arm'
  rightArm.position.set(0.42, 1.45, 0)
  body.add(rightArm)
  makePart('player-right-sleeve', [0.25, 0.38, 0.31], materials.shirt, rightArm, [0, -0.17, 0])
  makePart('player-right-forearm', [0.19, 0.34, 0.22], materials.skin, rightArm, [0, -0.49, 0.015])
  makePart('player-right-hand', [0.19, 0.16, 0.20], materials.skinShade, rightArm, [0, -0.72, 0.035])

  // 头部由头发、脸、耳朵和五官组成，保持像素块面但具备体积。
  const head = new THREE.Group()
  head.name = 'player-head'
  head.position.set(0, 1.78, 0)
  body.add(head)
  makePart('player-face', [0.58, 0.57, 0.49], materials.skin, head, [0, 0, 0.015])
  makePart('player-hair-cap', [0.62, 0.22, 0.55], materials.hair, head, [0, 0.22, -0.005])
  makePart('player-hair-back', [0.61, 0.42, 0.16], materials.hair, head, [0, -0.02, -0.25])
  makePart('player-hair-fringe-left', [0.22, 0.16, 0.12], materials.hairLight, head, [-0.17, 0.12, 0.29])
  makePart('player-hair-fringe-right', [0.22, 0.13, 0.12], materials.hair, head, [0.16, 0.15, 0.29])
  makePart('player-left-ear', [0.11, 0.18, 0.14], materials.skinShade, head, [-0.32, -0.02, 0.015])
  makePart('player-right-ear', [0.11, 0.18, 0.14], materials.skinShade, head, [0.32, -0.02, 0.015])
  makePart('player-left-eye', [0.055, 0.075, 0.025], materials.eye, head, [-0.14, 0.015, 0.27], false)
  makePart('player-right-eye', [0.055, 0.075, 0.025], materials.eye, head, [0.14, 0.015, 0.27], false)
  makePart('player-nose', [0.07, 0.055, 0.06], materials.skinShade, head, [0, -0.08, 0.285], false)

  // 人物与世界其他模型共用真实 DirectionalLight ShadowMap。
  // 人物移动/动画时由引擎动态失效 ShadowMap，避免使用固定脚底贴图伪造投影。
  root.traverse(object => {
    if (!object.isMesh) return
    object.castShadow = true
    object.receiveShadow = true
  })
  root.userData.updateAnimation = function updateAnimation(moving, seconds, dx = 0, dz = 0, gaitRate = 1) {
    const target = this
    const find = name => target.getObjectByName(name)
    const targetBody = find('player-body')
    const targetHead = find('player-head')
    const targetLeftLeg = find('player-left-leg')
    const targetRightLeg = find('player-right-leg')
    const targetLeftArm = find('player-left-arm')
    const targetRightArm = find('player-right-arm')

    if (Math.hypot(dx, dz) > 0.0005) {
      target.rotation.y = Math.atan2(dx, dz)
    }

    const previousSeconds = Number.isFinite(target.userData.gaitLastSeconds) ? target.userData.gaitLastSeconds : seconds
    const frameDelta = Math.max(0, Math.min(0.1, seconds - previousSeconds))
    target.userData.gaitLastSeconds = seconds
    const wasMoving = target.userData.gaitMoving === true
    if (moving && !wasMoving) target.userData.gaitPhase = 0.85
    if (moving) {
      target.userData.gaitPhase = (Number(target.userData.gaitPhase) || 0) + frameDelta * 9.5 * Math.max(0.35, Math.min(1.7, Number(gaitRate) || 1))
    }
    target.userData.gaitMoving = Boolean(moving)
    const gait = Number(target.userData.gaitPhase) || 0
    const stride = moving ? Math.sin(gait) : 0
    const bob = moving ? Math.abs(Math.sin(gait * 2)) * 0.045 : Math.sin(seconds * 2.2) * 0.008
    if (targetBody) targetBody.position.y = bob
    if (targetHead) targetHead.rotation.z = moving ? Math.sin(gait) * 0.025 : Math.sin(seconds * 1.6) * 0.012
    if (targetLeftLeg) targetLeftLeg.rotation.x = stride * 0.48
    if (targetRightLeg) targetRightLeg.rotation.x = -stride * 0.48
    if (targetLeftArm) targetLeftArm.rotation.x = -stride * 0.38
    if (targetRightArm) targetRightArm.rotation.x = stride * 0.38
  }

  root.userData.updateAnimation.call(root, false, 0)
  return root
}
