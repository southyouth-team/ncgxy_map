# Heap/DOM counter timeline (UpdateCounters are instant events).
# Usage: python -I 11_heap.py <trace.json>
import json
import sys

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)
samples = []

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
    if e.get("name") != "UpdateCounters" or (e.get("pid"), e.get("tid")) != MAIN:
        continue
    d = e.get("args", {}).get("data", {})
    samples.append(((e["ts"] - T0) / 1000.0, d.get("jsHeapSizeUsed", 0) / 1e6,
                    d.get("nodes"), d.get("jsEventListeners"), d.get("documents")))

print(f"samples: {len(samples)}")
print("time(ms)  heap(MB)  nodes  listeners  docs")
step = max(1, len(samples) // 25)
for i in range(0, len(samples), step):
    r, h, n, l, doc = samples[i]
    print(f"{r:>8.0f}  {h:>7.1f}  {n:>5}  {l:>9}  {doc}")
r, h, n, l, doc = samples[-1]
print(f"{r:>8.0f}  {h:>7.1f}  {n:>5}  {l:>9}  {doc}")

heaps = [s[1] for s in samples]
print(f"\nheap min={min(heaps):.1f}MB max={max(heaps):.1f}MB")
# biggest frame-over-frame jumps
jumps = [(samples[i][0], samples[i][1] - samples[i-1][1]) for i in range(1, len(samples))]
jumps.sort(key=lambda x: -abs(x[1]))
print("biggest heap deltas (ms, MB):", [(round(t, 0), round(d, 2)) for t, d in jumps[:8]])
