# Attribute GPU work to renderer processes; check who owns the heavy tail.
# Usage: python -I 13_gpu_pid.py <trace.json>
import json
import sys
from collections import defaultdict

PATH = sys.argv[1]
T0 = 155202588394
GPU_THREAD = (36484, 37024)

per_pid = defaultdict(list)          # renderer_pid -> [(rel_ms, dur_ms, used_bytes)]
unknown = 0

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
    if e.get("ph") != "X" or e.get("name") != "GPUTask":
        continue
    if (e.get("pid"), e.get("tid")) != GPU_THREAD:
        continue
    d = e.get("args", {}).get("data", {})
    rpid = d.get("renderer_pid")
    if rpid is None:
        unknown += 1
        continue
    per_pid[rpid].append(((e["ts"] - T0) / 1000.0, e.get("dur", 0) / 1000.0, d.get("used_bytes")))

print(f"GPUTask events with no renderer_pid: {unknown}")
for rpid, tasks in sorted(per_pid.items(), key=lambda kv: -sum(d for _, d, _ in kv[1])):
    durs = sorted(d for _, d, _ in tasks)
    total = sum(durs)
    print(f"\nrenderer_pid={rpid}: tasks={len(tasks)} busy={total:.1f}ms "
          f"avg={total/len(tasks):.3f}ms p95={durs[int(len(durs)*.95)]:.2f}ms max={max(durs):.2f}ms")
    # per-second occupancy
    sec = defaultdict(float)
    for r, d, _ in tasks:
        sec[int(r // 1000)] += d
    heavy_secs = [(s, round(v, 1)) for s, v in sorted(sec.items()) if v > 100]
    print("  seconds with >100ms GPU busy:", heavy_secs)
    # memory samples
    mem = [u for _, _, u in tasks if u]
    if mem:
        print(f"  GPU mem used_bytes: first={mem[0]/1e6:.1f}MB last={mem[-1]/1e6:.1f}MB max={max(mem)/1e6:.1f}MB")
    # first/last seen
    print(f"  active window: {tasks[0][0]:.0f}ms .. {tasks[-1][0]:.0f}ms")
