// 程序化天空层：渐变穹顶 + 太阳/月亮圆盘 + 上半球星空。
// 所有视觉参数来自 skyVisualState 的纯数据，本模块只负责 three 对象装配与生命周期。
import {
  SKY_DOME_RADIUS,
  CELESTIAL_ORBIT_RADIUS,
  STAR_COUNT,
  STAR_SHELL_RADIUS,
} from './skyVisualState.js'

const DOME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const DOME_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  varying vec3 vDirection;
  void main() {
    float h = normalize(vDirection).y;
    float mixAmount = smoothstep(-0.15, 0.4, h);
    gl_FragColor = vec4(mix(horizonColor, topColor, mixAmount), 1.0);
    #include <colorspace_fragment>
  }
`

const CELESTIAL_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// 太阳：白炽核心 + 双层暖色辉光，加性混合模拟发光体。
const SUN_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    float core = 1.0 - smoothstep(0.28, 0.32, d);
    float innerGlow = (1.0 - smoothstep(0.32, 0.62, d)) * 0.55;
    float outerGlow = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * 0.35;
    vec3 coreColor = vec3(1.0, 0.96, 0.82);
    vec3 glowColor = vec3(1.0, 0.72, 0.35);
    vec3 color = coreColor * core + glowColor * (innerGlow + outerGlow);
    float alpha = clamp(core + innerGlow + outerGlow, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(color * alpha, alpha);
    #include <colorspace_fragment>
  }
`

// 月亮：柔边圆盘 + 程序化 fbm 月海暗斑 + 淡蓝光辉光，普通透明混合。
const MOON_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float e = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i += 1) {
      value += amplitude * valueNoise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    float disk = 1.0 - smoothstep(0.46, 0.5, d);
    if (disk <= 0.001) discard;
    float maria = smoothstep(0.52, 0.72, fbm(p * 3.0 + 5.0));
    vec3 surface = mix(vec3(0.91, 0.94, 1.0), vec3(0.6, 0.66, 0.79), maria * 0.85);
    float limbShading = 1.0 - smoothstep(0.25, 0.5, d) * 0.25;
    float halo = (1.0 - smoothstep(0.5, 0.9, d)) * 0.18;
    vec3 haloColor = vec3(0.78, 0.85, 1.0);
    vec3 color = mix(haloColor, surface * limbShading, disk);
    float alpha = clamp(disk + halo * (1.0 - disk), 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

// 平面边长为可见主体半径（skyVisualState 的 SUN/MOON_DISK_RADIUS）的约 3.4/4.4 倍，给辉光预留空间。
const SUN_PLANE_SIZE = 96
const MOON_PLANE_SIZE = 44

function createDome(THREE) {
  const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS, 32, 16)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x111d31) },
      horizonColor: { value: new THREE.Color(0xb9d0c2) },
    },
    vertexShader: DOME_VERTEX_SHADER,
    fragmentShader: DOME_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const dome = new THREE.Mesh(geometry, material)
  dome.name = 'sky-dome'
  dome.frustumCulled = false
  dome.renderOrder = -1
  return { dome, material }
}

function createGlowBody(THREE, name, planeSize, fragmentShader, blending) {
  const geometry = new THREE.PlaneGeometry(planeSize, planeSize)
  const material = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: CELESTIAL_VERTEX_SHADER,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending,
  })
  const body = new THREE.Mesh(geometry, material)
  body.name = name
  body.castShadow = false
  body.receiveShadow = false
  return body
}

function createStars(THREE) {
  const positions = new Float32Array(STAR_COUNT * 3)
  for (let i = 0; i < STAR_COUNT; i += 1) {
    // 均匀球面采样，拒绝低仰角方向，保证星点只出现在上半天球。
    let x = 0
    let y = 0
    let z = 0
    do {
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const radial = Math.sqrt(Math.max(0, 1 - u * u))
      x = radial * Math.cos(theta)
      y = u
      z = radial * Math.sin(theta)
    } while (y <= 0.02)
    positions[i * 3] = x * STAR_SHELL_RADIUS
    positions[i * 3 + 1] = y * STAR_SHELL_RADIUS
    positions[i * 3 + 2] = z * STAR_SHELL_RADIUS
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  })
  const stars = new THREE.Points(geometry, material)
  stars.name = 'sky-stars'
  return stars
}

export function createSkyRuntime(THREE) {
  const group = new THREE.Group()
  const { dome, material: domeMaterial } = createDome(THREE)
  const sun = createGlowBody(THREE, 'sky-sun', SUN_PLANE_SIZE, SUN_FRAGMENT_SHADER, THREE.AdditiveBlending)
  const moon = createGlowBody(THREE, 'sky-moon', MOON_PLANE_SIZE, MOON_FRAGMENT_SHADER, THREE.NormalBlending)
  const stars = createStars(THREE)
  group.add(dome, sun, moon, stars)

  const origin = new THREE.Vector3(0, 0, 0)

  function placeBody(body, direction) {
    body.position
      .set(direction[0], direction[1], direction[2])
      .multiplyScalar(CELESTIAL_ORBIT_RADIUS)
    // 圆盘正面始终朝向球心（相机所在），group 位移不影响局部朝向。
    body.lookAt(origin)
  }

  function update(state) {
    domeMaterial.uniforms.topColor.value.setRGB(state.skyTop.r, state.skyTop.g, state.skyTop.b)
    domeMaterial.uniforms.horizonColor.value.setRGB(
      state.skyHorizon.r,
      state.skyHorizon.g,
      state.skyHorizon.b,
    )
    placeBody(sun, state.sun.direction)
    placeBody(moon, state.moon.direction)
    sun.material.uniforms.uOpacity.value = state.sun.opacity
    moon.material.uniforms.uOpacity.value = state.moon.opacity
    stars.material.opacity = state.starsOpacity
  }

  function followCamera(position) {
    group.position.copy(position)
  }

  function setIndoor(indoor) {
    group.visible = !indoor
  }

  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    group.traverse((object) => {
      object.geometry?.dispose?.()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material?.dispose?.()
    })
  }

  return { group, update, followCamera, setIndoor, dispose }
}
