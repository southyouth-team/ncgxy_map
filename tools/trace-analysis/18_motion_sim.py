# Simulate the exact movement/interpolation pipeline using real rAF gaps from the trace.
# Reimplements: FrameTiming clamp -> PhysicsRuntime accumulator -> interp -> gaitRate.
# Usage: python -I 18_motion_sim.py <trace.json>
import json
import math
import sys

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)
FIXED = 1 / 60
MAX_DELTA = 0.05
SPEED = 9.0

raf = []


def event_iter(path):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s.startswith("{"):
                continue
            if s.endswith(","):
                s = s[:-1]
            if not s.endswith("}"):
                continue
            try:
                yield json.loads(s)
            except Exception:
                continue


for e in event_iter(PATH):
    if e.get("ph") == "X" and (e.get("pid"), e.get("tid")) == MAIN \
            and e.get("name") == "FireAnimationFrame":
        raf.append((e["ts"] - T0) / 1000.0)
raf.sort()

# raw frame gaps in seconds, skip the first (idle -> active) huge gap
gaps = []
for i in range(1, len(raf)):
    g = (raf[i] - raf[i - 1]) / 1000.0
    if g < 0.25:
        gaps.append(g)

# ---- reimplement PhysicsRuntime step + interpolation, constant commanded speed ----
accumulator = 0.0
prev_step_pos = 0.0   # previousStepPosition
step_pos = 0.0        # position
rendered = []         # per-frame interpolated position
step_counts = []

for raw in gaps:
    delta = min(raw, MAX_DELTA)
    accumulator += delta
    steps = 0
    while accumulator + sys.float_info.epsilon >= FIXED and steps < 5:
        prev_step_pos = step_pos
        step_pos += SPEED * FIXED          # kinematic translation, no collisions
        accumulator -= FIXED
        steps += 1
    if accumulator >= FIXED:               # spiral guard
        accumulator %= FIXED
    alpha = max(0.0, min(1.0, accumulator / FIXED))
    interp = prev_step_pos + (step_pos - prev_step_pos) * alpha
    rendered.append(interp)
    step_counts.append(steps)

# per-frame rendered displacement
disp = [rendered[i] - rendered[i - 1] for i in range(1, len(rendered))]
# engine gaitRate: hypot(dx,dz)/max(delta,0.001) / nominal speed
gait = []
for i in range(1, len(rendered)):
    d = rendered[i] - rendered[i - 1]
    dt = min(gaps[i], MAX_DELTA)
    gait.append((d / max(dt, 0.001)) / SPEED)

n = len(disp)
zero_frames = sum(1 for d in disp if d < 0.001)
step_pattern = {s: step_counts.count(s) for s in sorted(set(step_counts))}


def stats(name, seq):
    avg = sum(seq) / len(seq)
    var = sum((x - avg) ** 2 for x in seq) / len(seq)
    sd = math.sqrt(var)
    print(f"{name}: avg={avg:.5f} min={min(seq):.5f} max={max(seq):.5f} "
          f"sd={sd:.5f} cv={100*sd/avg:.1f}%")


print(f"frames simulated: {n}")
print(f"physics steps per render frame: {step_pattern}")
stats("rendered displacement/frame (m)", disp)
print(f"zero-displacement frames: {zero_frames} ({100*zero_frames/n:.1f}%)")
stats("per-frame gaitRate (ideal=1.0)", gait)

# ideal continuous motion reference for the same frame timestamps
ideal_disp = [min(g, MAX_DELTA) * SPEED for g in gaps[1:]]
stats("ideal continuous displacement   ", ideal_disp)

# what if physics ran at 120Hz (fixed = frame rate), no interp needed?
# and what if display was 60Hz: coalesce pairs of frames
gaps60 = []
i = 0
while i + 1 < len(gaps):
    gaps60.append(gaps[i] + gaps[i + 1])
    i += 2
acc2, prev2, pos2, ren2 = 0.0, 0.0, 0.0, []
for raw in gaps60:
    delta = min(raw, MAX_DELTA)
    acc2 += delta
    while acc2 + sys.float_info.epsilon >= FIXED and True:
        prev2 = pos2
        pos2 += SPEED * FIXED
        acc2 -= FIXED
        if acc2 < FIXED:
            break
    alpha = max(0.0, min(1.0, acc2 / FIXED))
    ren2.append(prev2 + (pos2 - prev2) * alpha)
disp60 = [ren2[i] - ren2[i - 1] for i in range(1, len(ren2))]
stats("60Hz display displacement/frame  ", disp60)

# show a concrete 20-frame sample around a 16.7ms jitter frame
big = next((i for i, g in enumerate(gaps) if g > 0.015), None)
if big:
    lo = max(1, big - 4)
    hi = min(len(rendered), big + 8)
    print("\nsample around a >15ms frame (raw_ms, steps, interp_disp_mm, gait*100):")
    for i in range(lo, hi):
        d = rendered[i] - rendered[i - 1]
        dt = min(gaps[i], MAX_DELTA)
        gr = (d / max(dt, 0.001)) / SPEED
        print(f"  frame {i:4d}: gap={gaps[i]*1000:6.2f}ms steps={step_counts[i]} "
              f"disp={d*1000:7.2f}mm gait={gr:5.2f}")
