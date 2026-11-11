# Deep-dive: CrRendererMain occupancy, long tasks, self-time, GC, dropped frames.
# Usage: python -I 02_mainthread.py <trace.json>
import json
import sys
from collections import Counter

PATH = sys.argv[1]
MAIN = (38564, 38752)
T0 = 155202588394  # trace ts min, for relative timestamps

name_total = Counter()
name_self = Counter()
name_count = Counter()
root_tasks = []
long_roots = []
expensive_calls = []
gc_events = []
drop_events = []
counters_samples = []
softnav_args = Counter()
softnav_ph = Counter()
event_dispatch = Counter()
style_inside_call = 0
deopt_total = 0
deopt_count = 0
stackguard_total = 0
presentation_ts = []
event_timing = []

stack = []          # entries: ts, end, name, dur, child, bucket
busy_total = 0

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
    if e.get("ph") == "M" or (e.get("pid"), e.get("tid")) != MAIN:
        continue
    name = e.get("name", "?")
    ph = e.get("ph")
    ts = e.get("ts")
    dur = e.get("dur", 0) or 0

    if name == "SoftNavigationContext::OnInputOrScroll":
        softnav_ph[ph] += 1
        softnav_args[json.dumps(e.get("args", {}), sort_keys=True)[:160]] += 1
        continue
    if name == "DroppedFrame":
        drop_events.append((ts, dur, json.dumps(e.get("args", {}))[:300]))
        continue
    if name == "UpdateCounters" and ph == "X":
        d = e.get("args", {}).get("data", {})
        counters_samples.append((ts, d.get("jsHeapSizeUsed"), d.get("nodes"), d.get("jsEventListeners"), d.get("documents")))
        continue
    if name == "AnimationFrame::Presentation":
        presentation_ts.append(ts)
    if name == "EventTiming":
        d = e.get("args", {}).get("data", {})
        event_timing.append((ts, dur, d.get("type"), d.get("duration"), d.get("processingDuration"), d.get("interactionId")))
        continue
    if ph != "X":
        continue

    low = name.lower()
    if "gc" in low or name.startswith("CppGC"):
        gc_events.append((ts, name, dur))
    if name == "V8.DeoptimizeCode":
        deopt_count += 1
        deopt_total += dur
    if name in ("V8.StackGuard", "V8.HandleInterrupts", "V8.BytecodeBudgetInterrupt", "V8.BytecodeBudgetInterruptWithStackCheck"):
        stackguard_total += dur
    if name == "EventDispatch":
        t = e.get("args", {}).get("data", {}).get("type", "?")
        event_dispatch[(t, dur >= 16000)] += 1

    # pop completed entries; settle self time at pop
    while stack and stack[-1]["end"] <= ts:
        done = stack.pop()
        name_self[done["name"]] += done["dur"] - done["child"]
        if not stack:
            pass  # root settled

    is_root = len(stack) == 0
    bucket = None
    if is_root:
        busy_total += dur
        root_tasks.append((ts, dur, name))
        if dur >= 50000:
            entry_bucket = Counter()
            long_roots.append({"ts": ts, "dur": dur, "name": name, "bucket": entry_bucket})
            bucket = entry_bucket
    else:
        stack[-1]["child"] += dur
        if len(stack) == 1 and stack[0]["bucket"] is not None:
            stack[0]["bucket"][name] += dur  # direct child of a long root task
        if name == "AnimationFrame::StyleAndLayout":
            for anc in stack:
                if anc["name"] in ("FunctionCall", "v8.callFunction", "EvaluateScript", "TimerFire"):
                    style_inside_call += 1
                    break

    name_total[name] += dur
    name_count[name] += 1
    stack.append({"ts": ts, "end": ts + dur, "name": name, "dur": dur, "child": 0, "bucket": bucket})

    if name in ("FunctionCall", "v8.callFunction", "EvaluateScript", "TimerFire", "FireAnimationFrame") and dur >= 5000:
        d = e.get("args", {}).get("data", {})
        expensive_calls.append((ts, name, dur, d.get("functionName"), d.get("url"), d.get("lineNumber"), d.get("columnNumber")))

while stack:
    done = stack.pop()
    name_self[done["name"]] += done["dur"] - done["child"]

def ms(u):
    return u / 1000.0

print("=" * 70)
print("MAIN THREAD OCCUPANCY")
print("=" * 70)
span = 27.003
print(f"busy time (sum of root events): {ms(busy_total):.0f} ms over {span*1000:.0f} ms -> {busy_total/1_000_000/span*100:.1f}% occupancy")

buckets = Counter()
for ts, dur, nm in root_tasks:
    if dur < 5000: b = "<5ms"
    elif dur < 16000: b = "5-16ms"
    elif dur < 50000: b = "16-50ms"
    elif dur < 100000: b = "50-100ms"
    elif dur < 250000: b = "100-250ms"
    elif dur < 500000: b = "250-500ms"
    else: b = ">500ms"
    buckets[b] += 1
print("\nroot task duration distribution:")
for b in ["<5ms", "5-16ms", "16-50ms", "50-100ms", "100-250ms", "250-500ms", ">500ms"]:
    print(f"  {b:>10}: {buckets[b]}")

print("\n" + "=" * 70)
print(f"LONG ROOT TASKS (>=50ms): {len(long_roots)}")
print("=" * 70)
long_roots.sort(key=lambda r: -r["dur"])
for r in long_roots[:20]:
    print(f"\n@ {ms(r['ts']-T0):>9.1f} ms  dur={ms(r['dur']):>8.1f} ms  {r['name']}")
    for nm, d in r["bucket"].most_common(8):
        print(f"    child {ms(d):>9.1f} ms  {nm}")

print("\n" + "=" * 70)
print("TOP 25 BY TOTAL DURATION (main thread, X events)")
print("=" * 70)
for nm, d in name_total.most_common(25):
    print(f"  total {ms(d):>10.1f} ms  self {ms(name_self[nm]):>9.1f} ms  n={name_count[nm]:>7}  {nm}")

print("\n" + "=" * 70)
print("TOP 25 BY SELF TIME")
print("=" * 70)
for nm, d in name_self.most_common(25):
    print(f"  self {ms(d):>10.1f} ms  total {ms(name_total[nm]):>9.1f} ms  n={name_count[nm]:>7}  {nm}")

print("\n" + "=" * 70)
print(f"EXPENSIVE JS ENTRY EVENTS (>=5ms): {len(expensive_calls)}; top 25 by dur")
print("=" * 70)
expensive_calls.sort(key=lambda x: -x[2])
for ts, nm, dur, fn, url, line, col in expensive_calls[:25]:
    print(f"  {ms(dur):>8.1f} ms  {nm:<18} {fn}  @ {url}:{line}:{col}")

agg = Counter()
agg_n = Counter()
for ts, nm, dur, fn, url, line, col in expensive_calls:
    key = (fn, (url or "").split("/")[-1], line)
    agg[key] += dur
    agg_n[key] += 1
print("\nTOP 20 EXPENSIVE FUNCTIONS (aggregated, calls >=5ms only):")
for key, d in agg.most_common(20):
    print(f"  total {ms(d):>9.1f} ms  n={agg_n[key]:>4}  {key[0]}  {key[1]}:{key[2]}")

print("\n" + "=" * 70)
print("GC EVENTS ON MAIN THREAD (total >=1ms or max >=1ms)")
print("=" * 70)
gc_sum = Counter(); gc_max = Counter(); gc_n = Counter()
for ts, nm, dur in gc_events:
    gc_sum[nm] += dur; gc_n[nm] += 1
    gc_max[nm] = max(gc_max[nm], dur)
big_gc = [(nm, d) for nm, d in gc_sum.items() if d >= 1000 or gc_max[nm] >= 1000]
big_gc.sort(key=lambda x: -x[1])
for nm, d in big_gc:
    print(f"  total {ms(d):>8.1f} ms  max {ms(gc_max[nm]):>7.1f} ms  n={gc_n[nm]:>5}  {nm}")
print(f"\nV8.DeoptimizeCode: n={deopt_count}, total={ms(deopt_total):.1f} ms")
print(f"V8 interrupts (StackGuard/HandleInterrupts/BytecodeBudget): total={ms(stackguard_total):.1f} ms")
print(f"StyleAndLayout nested inside JS (forced style/layout): {style_inside_call}")

print("\n" + "=" * 70)
print(f"DROPPED FRAMES: {len(drop_events)}")
print("=" * 70)
for ts, dur, args in drop_events[:15]:
    print(f"  @ {ms(ts-T0):>9.1f} ms  dur={ms(dur):>6.1f}  {args}")

print("\n" + "=" * 70)
print("FRAME PRESENTATION INTERVALS")
print("=" * 70)
hist = Counter()
presentation_ts.sort()
for a, b in zip(presentation_ts, presentation_ts[1:]):
    dms = (b - a) / 1000.0
    if dms < 10: bk = "<10ms"
    elif dms < 20: bk = "10-20ms"
    elif dms < 35: bk = "20-35ms"
    elif dms < 50: bk = "35-50ms"
    elif dms < 100: bk = "50-100ms"
    else: bk = ">100ms"
    hist[bk] += 1
for bk in ["<10ms", "10-20ms", "20-35ms", "35-50ms", "50-100ms", ">100ms"]:
    print(f"  {bk:>10}: {hist[bk]}")

print("\n" + "=" * 70)
print("SOFTNAV INPUT/SCROLL FLOOD")
print("=" * 70)
print("ph distribution:", dict(softnav_ph))
for a, c in softnav_args.most_common(5):
    print(f"  {c:>8}  {a}")

print("\nEventDispatch types (type, slow>=16ms -> count):")
for (t, slow), c in event_dispatch.most_common(20):
    print(f"  {c:>6}  slow={slow}  {t}")

print("\n" + "=" * 70)
print("UPDATE COUNTERS (memory / DOM)")
print("=" * 70)
if counters_samples:
    heaps = [c[1] for c in counters_samples if c[1] is not None]
    nodes = [c[2] for c in counters_samples if c[2] is not None]
    print(f"samples={len(counters_samples)}  heap: {min(heaps)/1e6:.1f} -> {max(heaps)/1e6:.1f} MB  nodes: {min(nodes)} -> {max(nodes)}")
    print("first:", counters_samples[0])
    print("last :", counters_samples[-1])

print("\n" + "=" * 70)
print("SLOW INTERACTIONS (EventTiming duration >=50ms), top 15")
print("=" * 70)
slow_et = [x for x in event_timing if (x[3] or 0) >= 50]
slow_et.sort(key=lambda x: -(x[3] or 0))
for ts, dur, t, d, pd, iid in slow_et[:15]:
    print(f"  @ {ms(ts-T0):>9.1f} ms  type={t:<12} duration={ms(d or 0):>8.1f} ms  processing={ms(pd or 0):>8.1f} ms  iid={iid}")
print(f"slow interactions: {len(slow_et)} / {len(event_timing)} EventTiming records")
