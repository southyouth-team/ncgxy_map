# Per-second timeline + GPU regime change + contents of periodic slow rAF frames.
# Usage: python -I 06_timeline.py <trace.json>
import json
import sys
from collections import defaultdict

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)
GPU = (36484, 37024)

sec_main = defaultdict(float)
sec_raf = defaultdict(list)
sec_gpu = defaultdict(float)
sec_gpu_tasks = defaultdict(int)
sec_drops = defaultdict(int)
slow_frames = {}     # ts -> events inside
stack = []

INTERESTING = {11470700, 14941700}  # will match by proximity instead

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

# frame windows to inspect (the 10.5ms rAF at 11470.7 and periodic ~5ms ones)
inspect_windows = []
raf_events = []
for e in event_iter(PATH):
    if e.get("ph") == "M":
        continue
    key = (e.get("pid"), e.get("tid"))
    name = e.get("name", "?")
    ts = e.get("ts")
    dur = e.get("dur", 0) or 0
    r = rel(ts)
    sec = int(r // 1000)
    if key == MAIN and e.get("ph") == "X":
        sec_main[sec] += dur / 1000.0
        if name == "FireAnimationFrame":
            sec_raf[sec].append(dur / 1000.0)
            raf_events.append((ts, dur))
    elif key == GPU and e.get("ph") == "X" and name == "RunTask":
        sec_gpu[sec] += dur / 1000.0
        sec_gpu_tasks[sec] += 1
    elif name == "DroppedFrame":
        sec_drops[sec] += 1

def pct(values, p):
    if not values: return 0.0
    values = sorted(values)
    return values[min(len(values) - 1, int(len(values) * p))]

print("SEC  mainBusy  rAF(n/avg/p95/max)  GPUbusy(tasks)  drops")
for sec in range(28):
    rafs = sec_raf.get(sec, [])
    line = f"{sec:>3}  {sec_main.get(sec,0):>7.0f}ms  "
    if rafs:
        line += f"n={len(rafs):>3} avg={sum(rafs)/len(rafs):.2f} p95={pct(rafs,.95):.2f} max={max(rafs):.2f}  "
    else:
        line += "no rAF data               "
    line += f"{sec_gpu.get(sec,0):>6.0f}ms({sec_gpu_tasks.get(sec,0):>3})  {sec_drops.get(sec,0)}"
    print(line)

# inspect contents of selected slow rAF frames
targets = [11470700, 14941700, 26942500]  # approx ts us relative to T0 (10.5ms, 6.5ms, 10.2ms)
windows = [(T0 + t - 3000, T0 + t + 20000, t) for t in targets]
found = {t: [] for t in targets}
for e in event_iter(PATH):
    if e.get("ph") != "X" or (e.get("pid"), e.get("tid")) != MAIN:
        continue
    ts = e["ts"]; dur = e.get("dur", 0) or 0
    for w0, w1, t in windows:
        if w0 <= ts <= w1 and dur >= 200:
            found[t].append((rel(ts), e.get("name"), dur / 1000.0,
                             e.get("args", {}).get("data", {}).get("functionName")))

for t in targets:
    print("\n" + "=" * 70)
    print(f"EVENTS >=0.2ms AROUND rAF @ {t/1000:.1f}ms")
    print("=" * 70)
    for r, nm, dms, fn in sorted(found[t])[:25]:
        print(f"  @ {r:>9.1f} ms  {dms:>6.2f} ms  {nm}  {fn or ''}")
