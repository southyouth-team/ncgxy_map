# Targeted: console.info args, deopt timeline, 26.3s transition, async callbacks.
# Usage: python -I 07_targeted.py <trace.json>
import json
import sys
from collections import Counter, defaultdict

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)

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

console_infos = []
deopt_per_sec = Counter()
budget_per_sec = Counter()
tail_all = []                 # 26.2-26.45s every main-thread X event
non_raf_functions = Counter() # FunctionCall not named animate
raf_request_ts = []

for e in event_iter(PATH):
    if e.get("ph") == "M" or (e.get("pid"), e.get("tid")) != MAIN:
        continue
    name = e.get("name", "?")
    ts = e.get("ts")
    dur = e.get("dur", 0) or 0
    r = rel(ts)
    sec = int(r // 1000)

    if name == "V8Console::Info":
        console_infos.append((r, json.dumps(e.get("args", {}), ensure_ascii=False)[:500]))
    elif name == "V8.DeoptimizeCode":
        deopt_per_sec[sec] += 1
    elif name in ("V8.BytecodeBudgetInterrupt", "V8.BytecodeBudgetInterruptWithStackCheck"):
        budget_per_sec[sec] += 1
    elif e.get("ph") == "X":
        if 26200 <= r <= 26460:
            tail_all.append((r, name, dur / 1000.0, e.get("args", {}).get("data", {})))
        if name == "FunctionCall":
            fn = e.get("args", {}).get("data", {}).get("functionName")
            if fn != "animate":
                non_raf_functions[(fn, e["args"]["data"].get("url", "").split("/")[-1].split("?")[0],
                                   e["args"]["data"].get("lineNumber"))] += 1
        if name == "RequestAnimationFrame":
            raf_request_ts.append(r)

print("V8Console::Info events (17 total):")
for r, a in console_infos:
    print(f"  @ {r:>9.1f} ms  {a}")

print("\nDeoptimizeCode per second:", dict(sorted(deopt_per_sec.items())))
print("BytecodeBudgetInterrupt per second:", dict(sorted(budget_per_sec.items())))

print("\nALL main-thread X events 26.20s-26.46s:")
for r, nm, dms, data in sorted(tail_all):
    extra = ""
    if isinstance(data, dict):
        extra = str({k: v for k, v in data.items() if k in ("functionName", "url", "lineNumber", "type", "timerId")})[:180]
    print(f"  @ {r:>9.1f} ms  {dms:>6.2f} ms  {nm}  {extra}")

print("\nNon-animate FunctionCall entry points (count):")
for key, n in non_raf_functions.most_common(15):
    print(f"  n={n:>5}  {key}")

print(f"\nRequestAnimationFrame scheduling count: {len(raf_request_ts)}")
if raf_request_ts:
    print("first 10 scheduling times (ms):", [round(x, 1) for x in raf_request_ts[:10]])
    print("last 10:", [round(x, 1) for x in raf_request_ts[-10:]])
