# Inspect GPU process / Viz compositor threads for backdrop-filter style
# compositor pressure that renderer-main rAF intervals cannot reveal.
# Usage: python -I 21_compositor_pressure.py <trace.json>
import json
import sys
from collections import defaultdict

PATH = sys.argv[1]
T0 = 155202588394
WALK = (13100, 25800)
IDLE_TAIL = (26340, 27000)

process_names = {}
thread_names = {}


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


# First pass: process/thread metadata.
for e in event_iter(PATH):
    if e.get("ph") != "M":
        continue
    name = e.get("name", "")
    args = e.get("args", {})
    if name == "process_name":
        process_names[e.get("pid")] = args.get("name", "")
    elif name == "thread_name":
        thread_names[(e.get("pid"), e.get("tid"))] = args.get("name", "")

print("== processes ==")
for pid, name in sorted(process_names.items(), key=lambda kv: str(kv[1])):
    print(f"  pid={pid:<8} {name}")

print("\n== threads with compositor/gpu/raster in name ==")
compositor_threads = []
for (pid, tid), name in sorted(thread_names.items(), key=lambda kv: str(kv[1])):
    low = name.lower()
    if any(token in low for token in ("compositor", "gpu", "raster", "viz", "display")):
        compositor_threads.append((pid, tid))
        print(f"  pid={pid:<8} tid={tid:<8} {process_names.get(pid, '?')} :: {name}")

# Second pass: per-thread X-event occupancy during walk vs idle tail.
stats = defaultdict(lambda: {"walk_total": 0.0, "walk_n": 0, "walk_max": 0.0,
                             "idle_total": 0.0, "idle_n": 0, "idle_max": 0.0,
                             "heavy_walk": 0})
present_events = defaultdict(lambda: {"walk": 0, "idle": 0})

for e in event_iter(PATH):
    if e.get("ph") != "X":
        continue
    key = (e.get("pid"), e.get("tid"))
    if key not in compositor_threads:
        continue
    r = (e["ts"] - T0) / 1000.0
    dur = e.get("dur", 0) / 1000.0
    bucket = None
    if WALK[0] <= r < WALK[1]:
        bucket = "walk"
    elif IDLE_TAIL[0] <= r < IDLE_TAIL[1]:
        bucket = "idle"
    if bucket is None:
        continue
    s = stats[key]
    if bucket == "walk":
        s["walk_total"] += dur
        s["walk_n"] += 1
        s["walk_max"] = max(s["walk_max"], dur)
        if dur >= 4:
            s["heavy_walk"] += 1
    else:
        s["idle_total"] += dur
        s["idle_n"] += 1
        s["idle_max"] = max(s["idle_max"], dur)

walk_secs = (WALK[1] - WALK[0]) / 1000
idle_secs = (IDLE_TAIL[1] - IDLE_TAIL[0]) / 1000
print("\n== X-event occupancy on compositor/GPU threads ==")
for (pid, tid), s in sorted(stats.items(), key=lambda kv: -kv[1]["walk_total"]):
    name = thread_names.get((pid, tid), "?")
    print(f"\n  {process_names.get(pid, '?')} :: {name} (pid={pid} tid={tid})")
    if s["walk_n"]:
        print(f"    WALK n={s['walk_n']:6d} total={s['walk_total']:9.1f}ms "
              f"occupancy={100*s['walk_total']/(walk_secs*1000):5.1f}% "
              f"avg={s['walk_total']/s['walk_n']:5.2f}ms max={s['walk_max']:6.2f}ms heavy(>=4ms)={s['heavy_walk']}")
    if s["idle_n"]:
        print(f"    IDLE n={s['idle_n']:6d} total={s['idle_total']:9.1f}ms "
              f"occupancy={100*s['idle_total']/(idle_secs*1000):5.1f}% "
              f"avg={s['idle_total']/s['idle_n']:5.2f}ms max={s['idle_max']:6.2f}ms")
