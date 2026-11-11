# Frame pacing vs keyboard activity: did GPU-heavy overview frames miss 120Hz vsyncs?
# Usage: python -I 17_frame_pacing.py <trace.json>
import json
import sys
from collections import Counter

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)

raf_times = []
keydown_times = []
gpu_runs = []          # (rel_ms, dur_ms) on CrGpuMain
GPU_THREAD = (36484, 37024)


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
    ph = e.get("ph")
    pid, tid = e.get("pid"), e.get("tid")
    if ph == "X" and (pid, tid) == MAIN and e.get("name") == "FireAnimationFrame":
        raf_times.append((e["ts"] - T0) / 1000.0)
    elif ph == "X" and (pid, tid) == GPU_THREAD and e.get("name") == "RunTask":
        gpu_runs.append(((e["ts"] - T0) / 1000.0, e.get("dur", 0) / 1000.0))
    elif ph == "X" and (pid, tid) == MAIN and e.get("name") == "EventDispatch":
        t = e.get("args", {}).get("data", {}).get("type", "")
        if t.lower() in ("keydown", "keyup", "keypress"):
            keydown_times.append(((e["ts"] - T0) / 1000.0, t))

raf_times.sort()
keydown_times.sort()

print(f"rAF frames: {len(raf_times)}, key events: {len(keydown_times)}")
if keydown_times:
    print(f"key event window: {keydown_times[0][0]:.0f}ms .. {keydown_times[-1][0]:.0f}ms")
    key_types = Counter(t for _, t in keydown_times)
    print("key event types:", dict(key_types))


def pacing(window, label):
    frames = [t for t in raf_times if window[0] <= t < window[1]]
    if len(frames) < 4:
        print(f"\n{label}: too few frames ({len(frames)})")
        return
    gaps = [frames[i + 1] - frames[i] for i in range(len(frames) - 1)]
    n = len(gaps)
    missed = sum(1 for g in gaps if g > 12.0)
    double = sum(1 for g in gaps if g > 20.0)
    buckets = Counter()
    for g in gaps:
        if g <= 10: buckets["~8.3ms (120Hz)"] += 1
        elif g <= 14: buckets["~12ms"] += 1
        elif g <= 22: buckets["~16.7ms (60Hz)"] += 1
        elif g <= 30: buckets["~25ms"] += 1
        else: buckets[">30ms"] += 1
    avg = sum(gaps) / n
    print(f"\n{label} ({window[0]/1000:.1f}s-{window[1]/1000:.1f}s): frames={len(frames)} avg_gap={avg:.2f}ms")
    print(f"  gaps >12ms (missed 120Hz present): {missed}/{n} = {100*missed/n:.1f}%")
    print(f"  gaps >20ms (full 60Hz beat lost): {double}/{n} = {100*double/n:.1f}%")
    for k in ["~8.3ms (120Hz)", "~12ms", "~16.7ms (60Hz)", "~25ms", ">30ms"]:
        if buckets[k]:
            print(f"    {k}: {buckets[k]} ({100*buckets[k]/n:.1f}%)")
    print(f"  max gap: {max(gaps):.2f}ms")


pacing((2000, 10000), "steady window")
pacing((12000, 27000), "sandbox/overview tail")

# Keyboard-hold walking windows: clusters of keydowns with <400ms between events.
clusters = []
current = []
for t, typ in keydown_times:
    if not current or t - current[-1][0] < 400:
        current.append((t, typ))
    else:
        if len(current) >= 4:
            clusters.append((current[0][0], current[-1][0]))
        current = [(t, typ)]
if len(current) >= 4:
    clusters.append((current[0][0], current[-1][0]))
print(f"\nkey-hold clusters (>=4 events, gap<400ms): {len(clusters)}")
for start, end in clusters[:12]:
    frames = [t for t in raf_times if start - 50 <= t <= end + 50]
    gaps = [frames[i + 1] - frames[i] for i in range(len(frames) - 1)]
    if not gaps:
        continue
    missed = sum(1 for g in gaps if g > 12.0)
    gpu_in = [d for rt, d in gpu_runs if start - 50 <= rt <= end + 50]
    gpu_avg = sum(gpu_in) / len(gpu_in) if gpu_in else 0
    gpu_max = max(gpu_in) if gpu_in else 0
    print(f"  walk @{start/1000:5.1f}s dur={(end-start)/1000:4.1f}s frames={len(frames):3d} "
          f"missed={100*missed/len(gaps):5.1f}% avgGap={sum(gaps)/len(gaps):5.2f}ms "
          f"gpuAvg={gpu_avg:4.2f}ms gpuMax={gpu_max:4.2f}ms")
