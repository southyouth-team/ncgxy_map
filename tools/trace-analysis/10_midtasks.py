# All root tasks >=5ms (excluding the 305ms profiler artifact) with direct children.
# Usage: python -I 10_midtasks.py <trace.json>
import json
import sys

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)
stack = []
hits = []

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
    if e.get("ph") == "M" or (e.get("pid"), e.get("tid")) != MAIN or e.get("ph") != "X":
        continue
    ts = e["ts"]
    dur = e.get("dur", 0) or 0
    name = e.get("name", "?")
    while stack and stack[-1]["end"] <= ts:
        stack.pop()
    if not stack and 5000 <= dur < 50000:
        bucket = {}
        hits.append((ts, dur, name, bucket))
        stack.append({"ts": ts, "end": ts + dur, "name": name, "bucket": bucket, "isroot": True})
    else:
        if stack and stack[0].get("isroot") and len(stack) == 1:
            b = stack[0]["bucket"]
            b[name] = b.get(name, 0) + dur
        stack.append({"ts": ts, "end": ts + dur, "name": name, "bucket": None, "isroot": False})

for ts, dur, name, bucket in sorted(hits, key=lambda x: -x[1]):
    children = sorted(bucket.items(), key=lambda kv: -kv[1])[:5]
    ch = ", ".join(f"{nm}={d/1000:.1f}ms" for nm, d in children)
    print(f"@ {(ts-T0)/1000:>9.1f} ms  {dur/1000:>6.1f} ms  {name}  | {ch}")
