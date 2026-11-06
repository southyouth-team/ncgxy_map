import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

const WEATHER = ['clear', 'cloudy', 'rain', 'snow', 'fog']

export class SandboxRuntime {
  constructor(container, onSelect = () => {}) {
    this.container = container
    this.onSelect = onSelect
    this.objects = new Map()
    this.selected = null
    this.environment = { time: 14, weather: 'clear', wind: 0.2 }
    this.clock = new THREE.Clock()
    this.loader = new GLTFLoader()
    this.exporter = new GLTFExporter()
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.disposed = false
  }

  init() {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#b8d2df')
    this.scene.fog = new THREE.Fog('#b8d2df', 45, 180)
    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000)
    this.camera.position.set(18, 16, 22)
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.container.appendChild(this.renderer.domElement)

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.enableDamping = true
    this.orbit.target.set(0, 1, 0)
    this.transform = new TransformControls(this.camera, this.renderer.domElement)
    this.transform.addEventListener('dragging-changed', event => { this.orbit.enabled = !event.value })
    this.transform.addEventListener('objectChange', () => this.onSelect(this.selected))
    this.scene.add(this.transform.getHelper())

    this.hemi = new THREE.HemisphereLight(0xddeeff, 0x53604d, 1.5)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2)
    this.sun.position.set(20, 30, 10)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.scene.add(this.sun)
    this.ambient = new THREE.AmbientLight(0xffffff, 0.35)
    this.scene.add(this.ambient)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: '#879b79', roughness: 1 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    ground.name = 'Sandbox Ground'
    ground.userData.sandboxGround = true
    this.scene.add(ground)
    this.grid = new THREE.GridHelper(300, 120, '#61715f', '#aab6a0')
    this.grid.position.y = 0.012
    this.scene.add(this.grid)
    this.addPrimitive('box', 'Box')
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.applyEnvironment()
    this.animate()
    return this
  }

  animate = () => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    const delta = Math.min(this.clock.getDelta(), 0.05)
    if (this.weatherPoints) {
      const positions = this.weatherPoints.geometry.attributes.position
      for (let i = 0; i < positions.count; i++) {
        let y = positions.getY(i)
        y -= delta * (this.environment.weather === 'snow' ? 2.2 : 18) * (0.65 + this.environment.wind)
        let x = positions.getX(i) + delta * this.environment.wind * (this.environment.weather === 'snow' ? 1.2 : 5)
        if (y < 0) { y = 24 + Math.random() * 12; x = (Math.random() - 0.5) * 90 }
        if (x > 45) x = -45
        positions.setXYZ(i, x, y, positions.getZ(i))
      }
      positions.needsUpdate = true
    }
    this.orbit.update()
    this.renderer.render(this.scene, this.camera)
  }

  resize() {
    if (!this.renderer || this.disposed) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  addPrimitive(type = 'box', name) {
    const geometries = {
      box: () => new THREE.BoxGeometry(2, 2, 2),
      sphere: () => new THREE.SphereGeometry(1.15, 32, 24),
      cylinder: () => new THREE.CylinderGeometry(1, 1, 2, 32),
      cone: () => new THREE.ConeGeometry(1.1, 2.2, 32),
      torus: () => new THREE.TorusKnotGeometry(0.8, 0.28, 100, 16),
    }
    const geometry = (geometries[type] || geometries.box)()
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.38, 0.55), roughness: 0.72 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name || type + ' ' + (this.objects.size + 1)
    mesh.position.set((Math.random() - 0.5) * 5, type === 'torus' ? 1.4 : 1, (Math.random() - 0.5) * 5)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.sandboxObject = true
    mesh.userData.objectId = crypto.randomUUID()
    this.scene.add(mesh)
    this.objects.set(mesh.userData.objectId, mesh)
    this.select(mesh)
    return mesh
  }

  async importFile(file) {
    const url = URL.createObjectURL(file)
    try {
      const gltf = await this.loader.loadAsync(url)
      const root = gltf.scene || gltf.scenes?.[0]
      if (!root) throw new Error('文件中没有可加载的场景')
      root.name = file.name.replace(/\.(glb|gltf)$/i, '') || 'Imported Model'
      root.userData.sandboxObject = true
      root.userData.objectId = crypto.randomUUID()
      root.traverse(node => {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = true }
      })
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const max = Math.max(size.x, size.y, size.z) || 1
      root.scale.setScalar(4 / max)
      const scaledBox = new THREE.Box3().setFromObject(root)
      root.position.y -= scaledBox.min.y
      this.scene.add(root)
      this.objects.set(root.userData.objectId, root)
      this.select(root)
      return root
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  handlePointerDown = event => {
    if (this.transform.dragging) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const candidates = [...this.objects.values()]
    const hit = this.raycaster.intersectObjects(candidates, true).find(item => {
      let node = item.object
      while (node && !node.userData.sandboxObject) node = node.parent
      return Boolean(node)
    })
    if (!hit) { this.select(null); return }
    let target = hit.object
    while (target.parent && !target.userData.sandboxObject) target = target.parent
    this.select(target)
  }

  select(object) {
    this.selected = object || null
    if (object) this.transform.attach(object)
    else this.transform.detach()
    this.onSelect(object)
  }

  setTransformMode(mode) { this.transform.setMode(mode) }

  deleteSelected() {
    if (!this.selected) return
    const object = this.selected
    this.transform.detach()
    this.scene.remove(object)
    this.objects.delete(object.userData.objectId)
    this.disposeObject(object)
    this.selected = null
    this.onSelect(null)
  }

  duplicateSelected() {
    if (!this.selected) return null
    const copy = this.cloneObject(this.selected)
    copy.name = this.selected.name + ' Copy'
    copy.userData = { ...this.selected.userData, objectId: crypto.randomUUID(), sandboxObject: true }
    copy.position.x += 2
    this.scene.add(copy)
    this.objects.set(copy.userData.objectId, copy)
    this.select(copy)
    return copy
  }

  cloneObject(source) {
    const copy = cloneSkinned(source)
    copy.traverse(node => {
      if (!node.isMesh) return
      node.geometry = node.geometry?.clone()
      if (Array.isArray(node.material)) node.material = node.material.map(material => material.clone())
      else if (node.material) node.material = node.material.clone()
    })
    return copy
  }

  async exportObject(object = this.selected) {
    if (!object) throw new Error('请先选择一个模型')
    const exportRoot = this.cloneObject(object)
    exportRoot.position.set(0, 0, 0)
    exportRoot.rotation.set(0, 0, 0)
    exportRoot.scale.set(1, 1, 1)
    exportRoot.updateMatrixWorld(true)
    try {
      const result = await this.exporter.parseAsync(exportRoot, {
        binary: true,
        onlyVisible: false,
        trs: false,
        embedImages: true,
      })
      return result
    } finally {
      this.disposeObject(exportRoot)
    }
  }

  async exportAllObjects() {
    if (!this.objects.size) throw new Error('场景中没有可导出的模型')
    const exportRoot = new THREE.Group()
    exportRoot.name = 'Sandbox Assets'
    for (const object of this.objects.values()) exportRoot.add(this.cloneObject(object))
    exportRoot.updateMatrixWorld(true)
    try {
      return await this.exporter.parseAsync(exportRoot, {
        binary: true,
        onlyVisible: false,
        trs: false,
        embedImages: true,
      })
    } finally {
      this.disposeObject(exportRoot)
    }
  }

  applyEnvironment(config = {}) {
    this.environment = { ...this.environment, ...config }
    const hour = ((Number(this.environment.time) % 24) + 24) % 24
    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI))
    const sunAngle = ((hour - 6) / 24) * Math.PI * 2
    this.sun.position.set(Math.cos(sunAngle) * 35, Math.max(3, daylight * 42), Math.sin(sunAngle) * 35)
    this.sun.intensity = 0.12 + daylight * 2.2
    this.hemi.intensity = 0.25 + daylight * 1.35
    this.ambient.intensity = 0.12 + daylight * 0.38
    const night = daylight < 0.12
    const sky = night ? new THREE.Color('#101a32') : new THREE.Color('#b8d2df').lerp(new THREE.Color('#f4cda2'), 1 - daylight)
    this.scene.background = sky
    const weather = WEATHER.includes(this.environment.weather) ? this.environment.weather : 'clear'
    this.scene.fog.color.copy(sky)
    this.scene.fog.near = weather === 'fog' ? 5 : weather === 'rain' ? 24 : 45
    this.scene.fog.far = weather === 'fog' ? 55 : weather === 'rain' ? 115 : 180
    this.sun.color.set(weather === 'cloudy' || weather === 'rain' || weather === 'fog' ? '#c4d0d9' : '#fff1d2')
    this.grid.visible = weather !== 'fog'
    this.updateWeatherParticles(weather)
  }

  updateWeatherParticles(weather) {
    if (this.weatherPoints) {
      this.scene.remove(this.weatherPoints)
      this.weatherPoints.geometry.dispose()
      this.weatherPoints.material.dispose()
      this.weatherPoints = null
    }
    if (weather !== 'rain' && weather !== 'snow') return
    const count = weather === 'rain' ? 1800 : 900
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 90
      positions[i * 3 + 1] = Math.random() * 35
      positions[i * 3 + 2] = (Math.random() - 0.5) * 90
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({ color: weather === 'rain' ? '#dcecff' : '#ffffff', size: weather === 'rain' ? 0.09 : 0.16, transparent: true, opacity: 0.72 })
    this.weatherPoints = new THREE.Points(geometry, material)
    this.scene.add(this.weatherPoints)
  }

  async runTask(command) {
    const text = String(command || '').trim()
    if (!text) return '请输入任务指令'
    if (/雨|rain/i.test(text)) { this.applyEnvironment({ weather: 'rain' }); return '环境已切换为雨天' }
    if (/雪|snow/i.test(text)) { this.applyEnvironment({ weather: 'snow' }); return '环境已切换为雪天' }
    if (/雾|fog/i.test(text)) { this.applyEnvironment({ weather: 'fog' }); return '环境已切换为雾天' }
    if (/阴|多云|cloud/i.test(text)) { this.applyEnvironment({ weather: 'cloudy' }); return '环境已切换为多云' }
    if (/晴|clear/i.test(text)) { this.applyEnvironment({ weather: 'clear' }); return '环境已切换为晴天' }
    const time = text.match(/(?:时间|time)[^0-9]*(\d{1,2})(?:点|:00)?/i)
    if (time) { this.applyEnvironment({ time: Math.min(24, Number(time[1])) }); return '时间已调整为 ' + time[1] + ':00' }
    if (!this.selected) return '当前没有选中模型'
    const move = text.match(/(?:移动|move)[^\d-]*(-?\d+(?:\.\d+)?)[,，\s]+(-?\d+(?:\.\d+)?)[,，\s]+(-?\d+(?:\.\d+)?)/i)
    if (move) { this.selected.position.set(Number(move[1]), Number(move[2]), Number(move[3])); return '模型已移动到指定坐标' }
    const rotate = text.match(/(?:旋转|rotate)[^\d-]*(-?\d+(?:\.\d+)?)/i)
    if (rotate) { this.selected.rotation.y += THREE.MathUtils.degToRad(Number(rotate[1])); return '模型已旋转' }
    if (/删除|delete/i.test(text)) { this.deleteSelected(); return '已删除选中模型' }
    if (/复制|duplicate/i.test(text)) { this.duplicateSelected(); return '已复制选中模型' }
    if (/交互|触发|interact/i.test(text)) { this.selected.userData.lastInteractionAt = new Date().toISOString(); return '已触发对象交互：' + this.selected.name }
    return '未识别该指令。可用示例：移动 3,0,2；旋转 90；切换雨天；时间 18 点；复制模型；删除模型；触发交互'
  }

  serialize() {
    return JSON.stringify({ version: 1, environment: this.environment, scene: this.scene.toJSON() }, null, 2)
  }

  async loadDocument(document) {
    const parsed = typeof document === 'string' ? JSON.parse(document) : document
    const loader = new THREE.ObjectLoader()
    const restored = await loader.parseAsync(parsed.scene)
    for (const child of [...this.scene.children]) {
      if (child.userData?.sandboxObject) {
        this.scene.remove(child)
        this.disposeObject(child)
      }
    }
    this.objects.clear()
    for (const child of restored.children) {
      if (child.userData?.sandboxObject) {
        this.scene.add(child)
        this.objects.set(child.userData.objectId || crypto.randomUUID(), child)
      }
    }
    this.applyEnvironment(parsed.environment || {})
    this.select(null)
  }

  disposeObject(object) {
    object.traverse?.(node => {
      node.geometry?.dispose?.()
      if (Array.isArray(node.material)) node.material.forEach(material => material.dispose())
      else node.material?.dispose?.()
    })
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizeObserver?.disconnect()
    this.renderer?.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.transform?.dispose()
    this.orbit?.dispose()
    for (const object of this.objects.values()) this.disposeObject(object)
    this.renderer?.dispose()
    if (this.renderer?.domElement.parentNode === this.container) this.container.removeChild(this.renderer.domElement)
  }
}
