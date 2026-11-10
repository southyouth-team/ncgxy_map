/**
 * Keeps presentation animation time aligned with the bounded frame delta
 * consumed by input and the fixed-step physics accumulator.
 */
export function advanceFrameTiming(timestampMs, previousTimestampMs, simulationTimeSeconds = 0, maxDeltaSeconds = 0.05) {
  const timestamp = Number(timestampMs)
  const previous = Number(previousTimestampMs)
  const hasPrevious = previousTimestampMs !== null && Number.isFinite(previous)
  const rawDeltaSeconds = hasPrevious && Number.isFinite(timestamp)
    ? Math.max(0, (timestamp - previous) / 1000)
    : 0
  const maxDelta = Number.isFinite(Number(maxDeltaSeconds)) && Number(maxDeltaSeconds) >= 0
    ? Number(maxDeltaSeconds)
    : 0.05
  const deltaSeconds = Math.min(rawDeltaSeconds, maxDelta)
  const currentSimulationTime = Number.isFinite(Number(simulationTimeSeconds))
    ? Math.max(0, Number(simulationTimeSeconds))
    : 0

  return {
    previousTimestampMs: Number.isFinite(timestamp) ? timestamp : previousTimestampMs,
    rawDeltaSeconds,
    deltaSeconds,
    droppedFrameTimeSeconds: Math.max(0, rawDeltaSeconds - deltaSeconds),
    simulationTimeSeconds: currentSimulationTime + deltaSeconds,
  }
}
