# App-level hotspots + suspicious windows.
# Usage: python -I 04_hotspots.py <trace.json>
import json
import sys
from collections import Counter, defaultdict

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)
GPU = (36484, 37024)

fn_agg = defaultdict(lambda: [0, 0, 0])   # key -> [count, total_us, max_us]
window_pre = []     # 9.9s - 10.36s main
window_tail = []    # 26.3s - 27.0s main
gpu_tail = []
frame_windows = []  # the two 8-16ms rAF frames
raf_stack = []
gpu_sample_args = None
drop_ts = []

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

def rel(ts): return (ts - T0) / 1000.0

for e in event_iter(PATH):
    if e.get("ph") == "M":
        continue
    pid, tid = e.get("pid"), e.get("tid")
    name = e.get("name", "?")
    ts = e.get("ts")
    dur = e.get("dur", 0) or 0
    r = rel(ts)

    if name == "DroppedFrame":
        drop_ts.append(r)
        continue

    if (pid, tid) == GPU:
        if name == "GPUTask" and gpu_sample_args is None:
            gpu_sample_args = json.dumps(e.get("args", {}))[:500]
        if 26300 <= r <= 27003 and dur >= 2000:
            gpu_tail.append((r, name, dur, json.dumps(e.get("args", {}))[:200]))
        continue

    if (pid, tid) != MAIN or e.get("ph") != "X":
        continue

    if name == "FunctionCall":
        d = e.get("args", {}).get("data", {})
        key = (d.get("functionName"), (d.get("url") or "").split("/")[-1].split("?")[0], d.get("lineNumber"))
        a = fn_agg[key]
        a[0] += 1
        a[1] += dur
        a[2] = max(a[2], dur)

    if 9900 <= r <= 10360 and dur >= 500:
        window_pre.append((r, name, dur))
    if 26300 <= r <= 27003 and dur >= 500:
        window_tail.append((r, name, dur, json.dumps(e.get("args", {}).get("data", {}))[:160]))

print("=" * 70)
print("ALL FunctionCall EVENTS AGGREGATED (top 30 by total time)")
print("=" * 70)
rows = sorted(fn_agg.items(), key=lambda kv: -kv[1][1])
for (fn, file, line), (n, total, mx) in rows[:30]:
    print(f"  total {total/1000:>9.1f} ms  n={n:>6}  max {mx/1000:>6.1f} ms  avg {total/n/1000:>5.2f}  {fn}  {file}:{line}")

print("\n" + "=" * 70)
print("MAIN THREAD 9.9s-10.36s (events >=0.5ms) — before profiler startup")
print("=" * 70)
for r, nm, dur in sorted(window_pre):
    print(f"  @ {r:>9.1f} ms  {dur/1000:>7.1f} ms  {nm}")

print("\n" + "=" * 70)
print("MAIN THREAD 26.3s-27.0s TAIL (events >=0.5ms)")
print("=" * 70)
for r, nm, dur, data in sorted(window_tail):
    print(f"  @ {r:>9.1f} ms  {dur/1000:>7.1f} ms  {nm}  {data}")

print("\n" + "=" * 70)
print("GPU THREAD TAIL TASKS >=2ms")
print("=" * 70)
for r, nm, dur, data in sorted(gpu_tail):
    print(f"  @ {r:>9.1f} ms  {dur/1000:>7.1f} ms  {nm}  {data}")
print("\nGPUTask args sample:", gpu_sample_args)

print("\n" + "=" * 70)
print("DROPPED FRAME TIME RANGE")
print("=" * 70)
if drop_ts:
    print(f"count={len(drop_ts)}  first=@{drop_ts[0]:.1f}ms  last=@{drop_ts[-1]:.1f}ms  span={drop_ts[-1]-drop_ts[0]:.1f}ms")
    gaps = [b - a for a, b in zip(drop_ts, drop_ts[1:])]
    print(f"inter-drop gap min/avg/max: {min(gaps):.1f} / {sum(gaps)/len(gaps):.1f} / {max(gaps):.1f} ms")
