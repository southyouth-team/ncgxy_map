# Correlate every dropped frame with main-thread/GPU activity at that moment.
# Usage: python -I 05_drops.py <trace.json>
import json
import sys
from bisect import bisect_left
from collections import defaultdict

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)
GPU = (36484, 37024)
COMP = (38564, 36740)

drops = []
raf = []            # (ts, dur)
present = []        # ts
main_busy = []      # (ts, end, dur) root tasks on main
gpu_tasks = []      # (ts, dur)
comp_tasks = []

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
    if e.get("ph") == "M":
        continue
    key = (e.get("pid"), e.get("tid"))
    name = e.get("name", "?")
    ts = e.get("ts")
    dur = e.get("dur", 0) or 0
    if name == "DroppedFrame":
        drops.append((ts, e.get("args", {}).get("hasPartialUpdate")))
    elif key == MAIN and e.get("ph") == "X":
        if name == "FireAnimationFrame":
            raf.append((ts, dur))
        elif name == "AnimationFrame::Presentation":
            present.append(ts)
        elif name == "RunTask":
            main_busy.append((ts, ts + dur, dur))
    elif key == GPU and e.get("ph") == "X" and name == "RunTask" and dur >= 2000:
        gpu_tasks.append((ts, dur))
    elif key == COMP and e.get("ph") == "X" and name == "RunTask" and dur >= 2000:
        comp_tasks.append((ts, dur))

drops.sort()
raf.sort()
present.sort()
main_busy.sort()
raf_ts = [x[0] for x in raf]
busy_ts = [x[0] for x in main_busy]

def rel(ts): return (ts - T0) / 1000.0

print("ALL DROPPED FRAMES WITH CONTEXT")
print(f"{'drop@ms':>10} {'partial':>7} {'nearest rAF ms':>15} {'rAF dur ms':>11} {'main task overlapping':>23} {'gpu>=2ms':>10} {'comp>=2ms':>10}")
for ts, partial in drops:
    i = bisect_left(raf_ts, ts)
    candidates = []
    for j in (i - 1, i, i + 1):
        if 0 <= j < len(raf):
            candidates.append(raf[j])
    nearest = min(candidates, key=lambda x: abs(x[0] - ts)) if candidates else (None, None)
    overlap = [b for b in main_busy if b[0] <= ts <= b[1]]
    ov = f"{overlap[0][2]/1000:.1f}" if overlap else "-"
    g = [d for t, d in gpu_tasks if abs(t - ts) < 20000]
    c = [d for t, d in comp_tasks if abs(t - ts) < 20000]
    gs = f"{max(g)/1000:.1f}" if g else "-"
    cs = f"{max(c)/1000:.1f}" if c else "-"
    print(f"{rel(ts):>10.1f} {str(partial):>7} {rel(nearest[0]) if nearest[0] else 0:>15.1f} {nearest[1]/1000 if nearest[1] else 0:>11.2f} {ov:>23} {gs:>10} {cs:>10}")

# per-second summary
print("\nPER-SECOND SUMMARY (seconds containing drops)")
per = defaultdict(lambda: [0, 0, 0, 0])  # drops, presents, busy_ms, max_raf_ms
for ts, _ in drops:
    per[int(rel(ts) // 1000)][0] += 1
for ts in present:
    per[int(rel(ts) // 1000)][1] += 1
for ts, end, dur in main_busy:
    per[int(rel(ts) // 1000)][2] += dur / 1000.0
for ts, dur in raf:
    s = int(rel(ts) // 1000)
    if dur / 1000.0 > per[s][3]:
        per[s][3] = dur / 1000.0
for s in sorted(per):
    d, p, b, m = per[s]
    if d:
        print(f"  sec {s:>2}: drops={d:>2} presented={p:>3} mainBusy={b:>6.1f}ms maxRaf={m:>6.2f}ms")

print(f"\nGPU RunTask >=2ms: {len(gpu_tasks)} total")
for ts, dur in gpu_tasks[:20]:
    print(f"  @ {rel(ts):>9.1f} ms  {dur/1000:>6.1f} ms")
print(f"\nCompositor RunTask >=2ms: {len(comp_tasks)} total")
for ts, dur in comp_tasks[:20]:
    print(f"  @ {rel(ts):>9.1f} ms  {dur/1000:>6.1f} ms")
