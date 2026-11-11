# GPU regime change: find exact boundary and compare task stats before/after.
# Usage: python -I 08_gpu.py <trace.json>
import json
import sys

PATH = sys.argv[1]
T0 = 155202588394
GPU = (36484, 37024)
MAIN = (38564, 38752)

gpu_tasks = []
commit_dur = []
mailbox_dur = []
prepaint_dur = []

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
    if e.get("ph") != "X" or e.get("name") != "RunTask":
        continue
    if (e.get("pid"), e.get("tid")) == GPU:
        gpu_tasks.append((rel(e["ts"]), e.get("dur", 0) / 1000.0))

# re-scan for main-thread commit/mailbox stats in two windows
for e in event_iter(PATH):
    if e.get("ph") != "X" or (e.get("pid"), e.get("tid")) != MAIN:
        continue
    nm = e["name"]
    r = rel(e["ts"])
    if nm == "Commit":
        commit_dur.append((r, e.get("dur", 0) / 1000.0))
    elif nm == "DrawingBuffer::prepareMailbox":
        mailbox_dur.append((r, e.get("dur", 0) / 1000.0))
    elif nm == "PrePaint":
        prepaint_dur.append((r, e.get("dur", 0) / 1000.0))

heavy = [t for t in gpu_tasks if t[1] >= 4.0 and t[0] > 10700]  # exclude profiler-startup window
print(f"GPU RunTask total={len(gpu_tasks)}, >=4ms: {len(heavy)}")
if heavy:
    print(f"first heavy (>=4ms) GPU task: @ {heavy[0][0]:.1f} ms")
    print("heavy task timestamps (first 10):", [round(t[0], 1) for t in heavy[:10]])

boundary = heavy[0][0] if heavy else 99999
before = [d for r, d in gpu_tasks if 10700 < r < boundary]
after = [d for r, d in gpu_tasks if r >= boundary]

def stats(name, xs):
    if not xs:
        print(f"{name}: none")
        return
    xs_sorted = sorted(xs)
    print(f"{name}: n={len(xs)} sum={sum(xs):.1f}ms avg={sum(xs)/len(xs):.2f}ms "
          f"p50={xs_sorted[len(xs)//2]:.2f} p95={xs_sorted[int(len(xs)*0.95)]:.2f} max={max(xs):.2f}")

stats(f"GPU tasks BEFORE @{boundary:.0f}ms", before)
stats(f"GPU tasks AFTER  @{boundary:.0f}ms", after)

# per-100ms GPU busy around the boundary
print("\nGPU busy per 100ms bucket around boundary:")
buckets = {}
for r, d in gpu_tasks:
    if boundary - 1000 <= r <= boundary + 1500:
        b = int(r // 100) * 100
        buckets.setdefault(b, [0.0, 0])
        buckets[b][0] += d
        buckets[b][1] += 1
for b in sorted(buckets):
    mark = " <-- boundary" if b == int(boundary // 100) * 100 else ""
    print(f"  {b:>8.0f}ms: busy={buckets[b][0]:>6.1f}ms tasks={buckets[b][1]:>4}{mark}")

for label, data in (("Commit", commit_dur), ("prepareMailbox", mailbox_dur), ("PrePaint", prepaint_dur)):
    b = [d for r, d in data if r < boundary]
    a = [d for r, d in data if r >= boundary]
    if b and a:
        print(f"\n{label}: before avg={sum(b)/len(b):.3f}ms n={len(b)} | after avg={sum(a)/len(a):.3f}ms n={len(a)}")
