# Reconcile GPUTask vs RunTask cost inside the keyboard-walk windows.
# Usage: python -I 19_walk_gpu.py <trace.json>
import json
import sys
from collections import defaultdict

PATH = sys.argv[1]
T0 = 155202588394
GPU_THREAD = (36484, 37024)
MAIN = (38564, 38752)

WALKS = [(13100, 18500), (19000, 19600), (20000, 21400), (21800, 25800)]
IDLE_TAIL = (26340, 27000)

gpu_task = []
run_task = []
raf = []
keys = []


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
    if e.get("ph") != "X":
        continue
    r = (e["ts"] - T0) / 1000.0
    pid, tid = e.get("pid"), e.get("tid")
    if (pid, tid) == GPU_THREAD and e.get("name") == "GPUTask":
        gpu_task.append((r, e.get("dur", 0) / 1000.0))
    elif (pid, tid) == GPU_THREAD and e.get("name") == "RunTask":
        run_task.append((r, e.get("dur", 0) / 1000.0))
    elif (pid, tid) == MAIN and e.get("name") == "FireAnimationFrame":
        raf.append(r)
    elif (pid, tid) == MAIN and e.get("name") == "EventDispatch":
        if e.get("args", {}).get("data", {}).get("type", "").lower() == "keydown":
            keys.append(r)


def summarize(window, label):
    lo, hi = window
    gt = [d for r, d in gpu_task if lo <= r < hi]
    rt = [d for r, d in run_task if lo <= r < hi]
    frames = [r for r in raf if lo <= r < hi]
    secs = (hi - lo) / 1000.0
    print(f"\n{label} ({lo/1000:.1f}-{hi/1000:.1f}s, {secs:.1f}s, frames={len(frames)})")
    for name, seq in (("GPUTask", gt), ("RunTask", rt)):
        if not seq:
            print(f"  {name}: none")
            continue
        seq_sorted = sorted(seq)
        n = len(seq_sorted)
        total = sum(seq_sorted)
        heavy = [d for d in seq_sorted if d >= 4]
        print(f"  {name}: n={n} total={total:6.1f}ms occupancy={100*total/(secs*1000):5.1f}% "
              f"avg={total/n:5.2f}ms p95={seq_sorted[int(n*0.95)]:5.2f}ms max={max(seq_sorted):5.2f}ms "
              f"heavy(>=4ms)={len(heavy)}")


for w in WALKS:
    summarize(w, "WALK")
summarize(IDLE_TAIL, "POST-WALK TAIL")

# renderer_pid attribution of heavy GPUTasks during walks
heavy_owners = defaultdict(int)
for r, d in gpu_task:
    if d >= 4 and any(lo <= r < hi for lo, hi in WALKS):
        heavy_owners["heavy>=4ms"] += 1
print("\nheavy GPUTasks during all walk windows:", heavy_owners)
