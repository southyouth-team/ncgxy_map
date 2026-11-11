# Main-thread function profile and periodic events inside keyboard-walk windows.
# Usage: python -I 20_walk_hotspots.py <trace.json>
import json
import sys
from collections import defaultdict

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)
WALK = (13100, 25800)

fn_self = defaultdict(lambda: [0.0, 0, 0.0])   # name -> [total_ms, count, max_ms]
other = defaultdict(lambda: [0.0, 0, 0.0])
slow_events = []


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
    if e.get("ph") != "X" or (e.get("pid"), e.get("tid")) != MAIN:
        continue
    r = (e["ts"] - T0) / 1000.0
    if not (WALK[0] <= r < WALK[1]):
        continue
    dur = e.get("dur", 0) / 1000.0
    name = e.get("name", "")
    if name == "FunctionCall":
        fn = e.get("args", {}).get("data", {}).get("functionName", "") or "(anonymous)"
        bucket = fn_self[fn]
    else:
        bucket = other[name]
    bucket[0] += dur
    bucket[1] += 1
    bucket[2] = max(bucket[2], dur)
    if dur >= 2.0:
        fn = e.get("args", {}).get("data", {}).get("functionName", "")
        slow_events.append((r, name, fn, dur))

print("== top 30 FunctionCall by total time during walk ==")
for fn, (total, count, mx) in sorted(fn_self.items(), key=lambda kv: -kv[1][0])[:30]:
    print(f"  {total:8.2f}ms n={count:6d} max={mx:6.2f}  {fn}")

print("\n== non-FunctionCall events ==")
for name, (total, count, mx) in sorted(other.items(), key=lambda kv: -kv[1][0])[:25]:
    print(f"  {total:8.2f}ms n={count:6d} max={mx:6.2f}  {name}")

print(f"\n== events >=2ms during walk ({len(slow_events)}) ==")
for r, name, fn, dur in slow_events[:40]:
    print(f"  @{r/1000:6.2f}s {dur:6.2f}ms {name} {fn}")
