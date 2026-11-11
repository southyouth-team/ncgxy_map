# What exactly runs on GPU/Viz/Compositor threads in the heavy tail vs steady state.
# Usage: python -I 14_gpu_detail.py <trace.json>
import json
import sys
from collections import Counter

PATH = sys.argv[1]
T0 = 155202588394
THREADS = {
    (36484, 37024): "CrGpuMain",
    (36484, 3660):  "VizCompositor",
    (38564, 36740): "Compositor",
}
WINDOWS = {"steady(20.0-21.0s)": (20000, 21000), "tail(26.34-27.0s)": (26340, 27003)}

stats = {w: {t: Counter() for t in THREADS.values()} for w in WINDOWS}
counts = {w: {t: Counter() for t in THREADS.values()} for w in WINDOWS}
resize_events = []

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
    tname = THREADS.get((e.get("pid"), e.get("tid")))
    if tname is None:
        if e.get("name") == "EventDispatch":
            t = e.get("args", {}).get("data", {}).get("type", "")
            if "resize" in t.lower():
                resize_events.append(((e["ts"] - T0) / 1000.0, t))
        continue
    r = (e["ts"] - T0) / 1000.0
    for w, (w0, w1) in WINDOWS.items():
        if w0 <= r < w1 and e.get("ph") == "X":
            dur = e.get("dur", 0) or 0
            stats[w][tname][e["name"]] += dur / 1000.0
            counts[w][tname][e["name"]] += 1

for w in WINDOWS:
    print("=" * 72)
    print(w)
    print("=" * 72)
    for tname in THREADS.values():
        print(f"\n-- {tname} (total dur per event name) --")
        for nm, d in stats[w][tname].most_common(12):
            print(f"  {d:>9.2f} ms  n={counts[w][tname][nm]:>6}  {nm}")

print("\nresize-related EventDispatch records:", resize_events or "NONE")
