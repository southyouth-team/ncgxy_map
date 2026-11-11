/**
 * 走动平滑度诊断探针（仅在 ?motion-probe=1 时由引擎启用）。
 *
 * 标准 Performance trace 只能证明 rAF/合成器/GPU 的帧时序健康，无法记录
 * “用户实际看到的角色轨迹”。本探针在每帧记录渲染锚点位移、物理步数、
 * 插值 alpha、按需帧调度决策等边界数据，用来区分：
 *   - 显示节奏掉帧（帧间隔拉长）
 *   - 60Hz 物理量化（隔帧零位移，插值未生效）
 *   - 真实停帧（按住移动键时连续多帧零位移）
 *   - 垂直微抖（snap-to-ground / autostep 类问题）
 *   - 按需 rAF 门控误停
 * 分析逻辑保持纯函数，便于在 Node 测试中用合成样本验证。
 */

export const MOTION_PROBE_CAPACITY = 2400

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(sortedValues.length * ratio)))
  return sortedValues[index]
}

function mean(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const average = mean(values)
  const variance = mean(values.map(value => (value - average) ** 2))
  return Math.sqrt(variance)
}

function isHeld(sample) {
  return Boolean(sample && (sample.movementIntent || (sample.keysHeld || 0) > 0))
}

function horizontalDelta(sample) {
  return Math.hypot(sample.dx || 0, sample.dz || 0)
}

/**
 * 分类按住移动键时的低位移帧：
 *   quantized = 被满位移帧夹住的孤立低位移帧（物理步进节奏泄漏到渲染）
 *   stall     = 连续 >=2 个低位移帧组成的停滞段
 * summarizeMotion 与 extractMotionStalls 共用同一套判定，保证口径一致。
 */
function analyzeDisplacementRuns(samples) {
  const heldSamples = samples.filter(isHeld)
  const heldDisplacements = heldSamples.map(horizontalDelta)
  const sortedDisplacements = [...heldDisplacements].sort((a, b) => a - b)
  // p75 作为“满步”参考：即使 50% 帧零位移（典型 60Hz 量化），参考值仍稳定。
  const referenceDisplacement = percentile(sortedDisplacements, 0.75)
  const lowDisplacementThreshold = Math.max(1e-5, referenceDisplacement * 0.35)
  const fullDisplacementThreshold = referenceDisplacement * 0.75
  let quantizedFrames = 0
  let stallFrames = 0
  const stallRuns = []
  if (heldSamples.length > 0 && referenceDisplacement > 1e-6) {
    let runStart = -1
    for (let index = 0; index <= samples.length; index += 1) {
      const sample = index < samples.length ? samples[index] : null
      const inLowRun = isHeld(sample) && horizontalDelta(sample) < lowDisplacementThreshold
      if (inLowRun) {
        if (runStart < 0) runStart = index
        continue
      }
      if (runStart < 0) continue
      const runLength = index - runStart
      if (runLength >= 2) {
        stallFrames += runLength
        stallRuns.push({ start: runStart, length: runLength })
      } else {
        const loneIndex = runStart
        const previous = loneIndex > 0 ? samples[loneIndex - 1] : null
        const next = loneIndex < samples.length - 1 ? samples[loneIndex + 1] : null
        const neighborFull = [previous, next].some(neighbor =>
          isHeld(neighbor) && horizontalDelta(neighbor) > fullDisplacementThreshold)
        if (neighborFull) quantizedFrames += 1
      }
      runStart = -1
    }
  }
  return { quantizedFrames, stallFrames, stallRuns }
}

/**
 * 导出停顿段前后窗口的逐帧明细（含指令/实际速度与碰撞接触），用于区分：
 * 碰撞阻挡（desiredSpeed 高、actualSpeed 低、wallContacts>0）、
 * 输入/电机断供（desiredSpeed≈0）、插值问题（双速度正常但 disp 低）。
 * 纯函数；frames 数值经过舍入，便于直接 JSON 序列化回贴。
 */
export function extractMotionStalls(samples, { context = 3, maxWindows = 6 } = {}) {
  const { stallFrames, stallRuns } = analyzeDisplacementRuns(samples)
  const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits))
  const windows = stallRuns.slice(0, Math.max(1, maxWindows)).map(run => {
    const from = Math.max(0, run.start - context)
    const to = Math.min(samples.length - 1, run.start + run.length - 1 + context)
    const frames = []
    for (let index = from; index <= to; index += 1) {
      const sample = samples[index]
      frames.push({
        index,
        intervalMs: round(sample.intervalMs, 2),
        disp: round(horizontalDelta(sample), 5),
        steps: Number(sample.physicsSteps) || 0,
        alpha: round(sample.physicsAlpha, 3),
        desiredSpeed: round(sample.desiredSpeed, 3),
        actualSpeed: round(sample.actualSpeed, 3),
        wallContacts: Number(sample.wallContacts) || 0,
        contacts: Number(sample.contacts) || 0,
        grounded: sample.grounded === true,
        renderCostMs: round(sample.renderCostMs, 2),
        drawCalls: Number(sample.drawCalls) || 0,
      })
    }
    return { startIndex: run.start, length: run.length, frames }
  })
  return { stallFrames, windows }
}

/**
 * Analyze a sequence of per-frame samples recorded by MotionProbe.record().
 * Pure function: no DOM, no THREE, no hidden state.
 * @param {Array<object>} samples frame samples in chronological order
 * @returns {object} statistical report with human-readable anomalies
 */
export function summarizeMotion(samples) {
  const frameCount = samples.length
  if (!frameCount) {
    return {
      frameCount: 0,
      windowMs: 0,
      anomalies: [],
    }
  }

  const intervals = samples.map(sample => Number(sample.intervalMs) || 0).filter(value => value > 0)
  const sortedIntervals = [...intervals].sort((a, b) => a - b)
  const medianInterval = percentile(sortedIntervals, 0.5)
  const intervalP95 = percentile(sortedIntervals, 0.95)
  const maxInterval = sortedIntervals[sortedIntervals.length - 1] || 0
  const longFrameThreshold = medianInterval * 1.75
  const longFrameCount = intervals.filter(value => value > longFrameThreshold).length

  const heldSamples = samples.filter(isHeld)
  const heldFrameCount = heldSamples.length
  const heldDisplacements = heldSamples.map(horizontalDelta)
  const sortedDisplacements = [...heldDisplacements].sort((a, b) => a - b)
  // p75 作为“满步”参考：即使 50% 帧零位移（典型 60Hz 量化），参考值仍稳定。
  const referenceDisplacement = percentile(sortedDisplacements, 0.75)
  const medianDisplacement = percentile(sortedDisplacements, 0.5)
  const maxDisplacement = sortedDisplacements[sortedDisplacements.length - 1] || 0
  const displacementMean = mean(heldDisplacements)
  const displacementCv = displacementMean > 1e-9
    ? standardDeviation(heldDisplacements) / displacementMean
    : 0

  const { quantizedFrames, stallFrames } = analyzeDisplacementRuns(samples)
  const zeroDisplacementFrames = quantizedFrames + stallFrames

  const stepHistogram = { 0: 0, 1: 0, '2+': 0 }
  let doubleStepFrames = 0
  for (const sample of samples) {
    const steps = Number(sample.physicsSteps) || 0
    if (steps >= 2) {
      stepHistogram['2+'] += 1
      doubleStepFrames += 1
    } else {
      stepHistogram[steps === 1 ? 1 : 0] += 1
    }
  }

  const verticalDeltas = heldSamples.map(sample => Math.abs(sample.dy || 0))
  const maxAbsVerticalDelta = verticalDeltas.length ? Math.max(...verticalDeltas) : 0
  const meanAbsVerticalDelta = mean(verticalDeltas)

  const renderCosts = samples.map(sample => Number(sample.renderCostMs) || 0).sort((a, b) => a - b)
  const renderCostP95 = percentile(renderCosts, 0.95)
  const renderCostMax = renderCosts[renderCosts.length - 1] || 0
  const drawCallValues = samples.map(sample => Number(sample.drawCalls) || 0).sort((a, b) => a - b)
  const drawCallsMedian = percentile(drawCallValues, 0.5)
  const drawCallsMax = drawCallValues[drawCallValues.length - 1] || 0
  const trianglesMax = samples.reduce((max, sample) => Math.max(max, Number(sample.triangles) || 0), 0)
  const shadowRate = heldFrameCount
    ? heldSamples.filter(sample => sample.shadowInvalidated === true).length / heldFrameCount
    : 0
  const gateStopWhileHeldFrames = heldSamples.filter(sample => sample.gateContinues === false).length

  const anomalies = []
  if (longFrameCount > 0) {
    anomalies.push(`帧间隔异常（疑似掉帧）：${longFrameCount} 帧超过中位间隔 1.75 倍（阈值 ${longFrameThreshold.toFixed(2)}ms）`)
  }
  if (quantizedFrames > 0) {
    anomalies.push(`移动量化（插值疑似缺失）：${quantizedFrames} 帧在按住移动键时零/低位移且与满位移帧交替`)
  }
  if (stallFrames >= 2) {
    anomalies.push(`按键按住但角色静止：${stallFrames} 帧连续低位移`)
  }
  if (doubleStepFrames > 0) {
    anomalies.push(`单帧执行多个物理步：${doubleStepFrames} 帧（螺旋追赶或长帧后的补步）`)
  }
  if (maxAbsVerticalDelta > 0.01) {
    anomalies.push(`垂直微抖：移动中最大单帧 Y 位移 ${maxAbsVerticalDelta.toFixed(4)}m`)
  }
  if (gateStopWhileHeldFrames > 0) {
    anomalies.push(`按需帧调度停帧：${gateStopWhileHeldFrames} 帧按住移动键但未请求下一帧`)
  }
  if (medianInterval > 0 && renderCostP95 > medianInterval * 0.8) {
    anomalies.push(`渲染 CPU 耗时逼近帧预算：p95 ${renderCostP95.toFixed(2)}ms / 中位帧间隔 ${medianInterval.toFixed(2)}ms`)
  }

  return {
    frameCount,
    windowMs: Number(intervals.reduce((sum, value) => sum + value, 0).toFixed(1)),
    mode: samples[samples.length - 1]?.mode ?? null,
    // 顶层标量字段，便于测试与控制台快速判读。
    longFrameCount,
    heldFrameCount,
    zeroDisplacementFrames,
    quantizedFrames,
    stallFrames,
    doubleStepFrames,
    maxAbsVerticalDelta: Number(maxAbsVerticalDelta.toFixed(5)),
    gateStopWhileHeldFrames,
    intervalMs: {
      median: Number(medianInterval.toFixed(3)),
      p95: Number(intervalP95.toFixed(3)),
      max: Number(maxInterval.toFixed(3)),
      longFrameCount,
    },
    displacement: {
      median: Number(medianDisplacement.toFixed(5)),
      reference: Number(referenceDisplacement.toFixed(5)),
      max: Number(maxDisplacement.toFixed(5)),
      cv: Number(displacementCv.toFixed(4)),
      quantizedFrames,
      stallFrames,
      zeroDisplacementFrames,
    },
    physics: {
      stepHistogram,
      doubleStepFrames,
    },
    vertical: {
      maxAbsDelta: Number(maxAbsVerticalDelta.toFixed(5)),
      meanAbsDelta: Number(meanAbsVerticalDelta.toFixed(5)),
    },
    renderCostMs: {
      p95: Number(renderCostP95.toFixed(3)),
      max: Number(renderCostMax.toFixed(3)),
    },
    drawCalls: {
      median: drawCallsMedian,
      max: drawCallsMax,
    },
    trianglesMax,
    shadowInvalidationRate: Number(shadowRate.toFixed(3)),
    anomalies,
  }
}

export class MotionProbe {
  constructor({ capacity = MOTION_PROBE_CAPACITY } = {}) {
    this.capacity = Math.max(10, Math.floor(capacity))
    this.samples = []
    this.environment = null
  }

  setEnvironment(environment) {
    this.environment = environment ? { ...environment } : null
  }

  record(sample) {
    if (!sample || typeof sample !== 'object') return
    this.samples.push(sample)
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity)
    }
  }

  analyze() {
    const report = summarizeMotion(this.samples)
    if (this.environment) report.environment = { ...this.environment }
    return report
  }

  clear() {
    this.samples.length = 0
  }
}
