# Compare steady-state vs heavy-tail GPU windows explicitly.
# Usage: python -I 09_gpu_tail.py <trace.json>
import json
import sys

PATH = sys.argv[1]
T0 = 155202588394
GPU = (36484, 37024)

A0, A1 = 10700, 26300   # steady state
B0, B1 = 26340, 27003   # heavy tail

win = {"A_steady": [], "B_tail": []}

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
    if e.get("ph") != "X" or e.get("name") != "RunTask" or (e.get("pid"), e.get("tid")) != GPU:
        continue
    r = (e["ts"] - T0) / 1000.0
    d = e.get("dur", 0) / 1000.0
    if A0 <= r < A1:
        win["A_steady"].append((r, d))
    elif B0 <= r <= B1:
        win["B_tail"].append((r, d))

for label, (w0, w1) in (("A_steady", (A0, A1)), ("B_tail", (B0, B1))):
    xs = win[label]
    durs = sorted(d for _, d in xs)
    span = (w1 - w0) / 1000.0
    busy = sum(durs)
    print(f"{label}: span={span:.2f}s tasks={len(xs)} busy={busy:.1f}ms occupancy={busy/(span*1000)*100:.1f}%")
    if durs:
        print(f"  per-task avg={sum(durs)/len(durs):.3f}ms p50={durs[len(durs)//2]:.3f} p95={durs[int(len(durs)*.95)]:.3f} max={max(durs):.2f}")
    heavy = sum(1 for d in durs if d >= 4)
    print(f"  tasks >=4ms: {heavy} ({heavy/max(len(durs),1)*100:.1f}%)")
