# Identify foreign renderer processes and align heavy GPU tasks with frame cadence.
# Usage: python -I 15_owner.py <trace.json>
import json
import sys
from collections import defaultdict

PATH = sys.argv[1]
T0 = 155202588394
GPU_THREAD = (36484, 37024)
MAIN = (38564, 38752)

proc_names = {}
thread_names = defaultdict(dict)
gpu_runs = []          # (rel_ms, dur_ms) all GPU RunTasks
heavy_runs = []        # >=4ms
raf_times = []         # map rAF FireAnimationFrame timestamps
foreign_thread_activity = defaultdict(list)  # pid -> (rel, name, dur)

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
    pid = e.get("pid")
    if ph == "M" and e.get("name") == "process_name":
        proc_names[pid] = e.get("args", {}).get("name")
    elif ph == "M" and e.get("name") == "thread_name":
        thread_names[pid][e.get("tid")] = e.get("args", {}).get("name")
    elif ph == "X":
        r = (e["ts"] - T0) / 1000.0
        if (pid, e.get("tid")) == GPU_THREAD and e.get("name") == "RunTask":
            d = e.get("dur", 0) / 1000.0
            gpu_runs.append((r, d))
            if d >= 4 and r > 26300:
                heavy_runs.append((r, d))
        elif (pid, e.get("tid")) == MAIN and e.get("name") == "FireAnimationFrame":
            raf_times.append(r)
        elif pid in (9936, 15156) and e.get("dur", 0) >= 1000:
            foreign_thread_activity[pid].append((r, thread_names.get(pid, {}).get(e.get("tid"), e.get("tid")),
                                                  e.get("name"), e.get("dur", 0) / 1000.0))

print("process names:", proc_names)
for pid in (9936, 15156, 21916, 37960):
    print(f"\npid {pid}: name={proc_names.get(pid)} threads={list(thread_names.get(pid, {}).values())[:12]}")

print("\nheavy GPU RunTasks (>=4ms) in tail, with nearest map rAF frame gap:")
raf_times.sort()
import bisect
for r, d in heavy_runs[:25]:
    i = bisect.bisect_left(raf_times, r)
    near = min((abs(r - x) for x in raf_times[max(0, i-1):i+2]), default=-1)
    print(f"  gpu @ {r:>9.1f} ms dur={d:>6.2f}  nearest rAF frame gap={near:>5.2f} ms")

# cadence summary: are heavy tasks phase-locked to 8.3ms frame grid?
gaps = [heavy_runs[i+1][0] - heavy_runs[i][0] for i in range(len(heavy_runs)-1)]
print(f"\nheavy-task count={len(heavy_runs)} inter-task gaps: min={min(gaps):.2f} avg={sum(gaps)/len(gaps):.2f} max={max(gaps):.2f}")

for pid in (9936, 15156):
    acts = foreign_thread_activity[pid]
    print(f"\npid {pid} X events >=1ms: {len(acts)}")
    for r, tn, nm, d in acts[:15]:
        print(f"  @ {r:>9.1f} ms {d:>6.2f} ms [{tn}] {nm}")
