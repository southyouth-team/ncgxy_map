<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { createCampusEngine } from './three/engine/createCampusEngine.js'

const viewport = ref(null)
const activeMode = ref('overview')
const loading = ref(true)
const errorMessage = ref('')
const engineReady = ref(false)

let engine

const modes = [
  { id: 'overview', label: '上帝视角', hint: '像素地图' },
  { id: 'thirdPerson', label: '第三人称', hint: '跟随漫游' },
  { id: 'firstPerson', label: '沉浸视角', hint: '第一人称' },
]

function switchMode(mode) {
  activeMode.value = mode
  engine?.setMode(mode)
}

function focusCampus() {
  engine?.focusCampus()
}

function toggleHelp() {
  const panel = document.querySelector('.help-panel')
  panel?.classList.toggle('is-visible')
}

onMounted(async () => {
  try {
    engine = createCampusEngine(viewport.value, {
      onReady: () => {
        loading.value = false
        engineReady.value = true
      },
      onError: (error) => {
        errorMessage.value = error?.message || '三维场景初始化失败'
        loading.value = false
      },
    })
    await engine.init()
  } catch (error) {
    errorMessage.value = error?.message || '三维场景初始化失败'
    loading.value = false
  }
})

onBeforeUnmount(() => {
  engine?.dispose()
})
</script>

<template>
  <main :class="['app-shell', { 'is-overview': activeMode === 'overview' }]">
    <div ref="viewport" class="scene-viewport"></div>

    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark">NC</div>
        <div>
          <div class="brand-title">南昌工学院</div>
          <div class="brand-subtitle">NANCHANG INSTITUTE OF TECHNOLOGY · 3D CAMPUS</div>
        </div>
      </div>
      <div class="topbar-status"><span class="status-dot"></span> 像素风格样板</div>
    </header>

    <section class="intro-card">
      <div class="eyebrow">CAMPUS EXPLORER / 01</div>
      <h1>探索校园<br /><span>从这里开始</span></h1>
      <p>等距像素风格样板场景 · 校园布局为演示数据，尚非真实测绘。</p>
      <div class="intro-rule"><span></span></div>
      <div class="intro-foot">INTERACTIVE CAMPUS MAP</div>
    </section>

    <nav class="mode-switcher" aria-label="视角切换">
      <button
        v-for="mode in modes"
        :key="mode.id"
        :class="['mode-button', { active: activeMode === mode.id }]"
        @click="switchMode(mode.id)"
      >
        <span class="mode-label">{{ mode.label }}</span>
        <span class="mode-hint">{{ mode.hint }}</span>
      </button>
    </nav>

    <aside class="control-card">
      <div class="control-heading">
        <span>操作指南</span>
        <button class="help-toggle" aria-label="显示操作指南" @click="toggleHelp">?</button>
      </div>
      <div class="help-panel is-visible">
        <template v-if="activeMode === 'overview'">
          <div class="control-row"><kbd>拖动</kbd><span>平移视野</span></div>
          <div class="control-row"><kbd>滚轮</kbd><span>缩放校园</span></div>
          <div class="control-row"><kbd>双击</kbd><span>聚焦场景</span></div>
        </template>
        <template v-else-if="activeMode === 'thirdPerson'">
          <div class="control-row"><kbd>W A S D</kbd><span>移动观察目标</span></div>
          <div class="control-row"><kbd>拖动</kbd><span>环绕旋转</span></div>
          <div class="control-row"><kbd>滚轮</kbd><span>调整跟随距离</span></div>
        </template>
        <template v-else>
          <div class="control-row"><kbd>W A S D</kbd><span>前后左右移动</span></div>
          <div class="control-row"><kbd>鼠标</kbd><span>控制视线方向</span></div>
          <div class="control-row"><kbd>Shift</kbd><span>加速移动</span></div>
          <div class="control-row"><kbd>Esc</kbd><span>退出鼠标控制</span></div>
        </template>
      </div>
      <div class="control-foot">方向以当前镜头朝向为基准</div>
    </aside>

    <div class="bottom-bar">
      <div class="coordinates"><span class="coordinate-dot"></span> CAMPUS / NANCHANG · CHINA</div>
      <button class="reset-button" @click="focusCampus"><span>↗</span> 重置视角</button>
    </div>

    <div v-if="loading" class="loading-screen">
      <div class="loader"></div>
      <div>正在加载像素风格样板场景</div>
      <span>INITIALIZING SCENE</span>
    </div>
    <div v-if="errorMessage" class="error-toast">{{ errorMessage }}</div>
    <div v-if="activeMode === 'firstPerson' && engineReady" class="first-person-hint">
      点击场景进入沉浸漫游 · 按 Esc 释放鼠标
    </div>
  </main>
</template>
