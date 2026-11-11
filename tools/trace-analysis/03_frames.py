# Frame pipeline / compositor / GPU / stall correlation.
# Usage: python -I 03_frames.py <trace.json>
import json
import sys
from collections import Counter, defaultdict

PATH = sys.argv[1]
T0 = 155202588394
THREADS = {
    (38564, 38752): "CrRendererMain",
    (38564, 36740): "Compositor",
    (36484, 37024): "CrGpuMain",
    (36484, 3660):  "VizCompositor",
}

drops = []                      # all DroppedFrame events, any thread
th_total = defaultdict(Counter)
th_self = defaultdict(Counter)
th_count = defaultdict(Counter)
stacks = defaultdict(list)
roots = defaultdict(list)       # per thread root X events
raf_durs = []                   # FireAnimationFrame on main
anim_durs = []                  # AnimationFrame on main
stall_window_events = []
profiler_events = []
update_counter_raw = []
pipeline = Counter()
pipeline_n = Counter()
STALL_TS = T0 + 10_358_400      # the 305ms task, approx; window +/- 400ms

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
    tname = THREADS.get(key)
    name = e.get("name", "?")
    ph = e.get("ph")
    ts = e.get("ts")
    dur = e.get("dur", 0) or 0

    if name == "DroppedFrame":
        drops.append((ts, tname or str(key), dur, json.dumps(e.get("args", {}))[:400]))
        continue
    if name == "UpdateCounters" and len(update_counter_raw) < 3:
        update_counter_raw.append((ph, json.dumps(e.get("args", {}))[:400]))
    if name in ("CpuProfiler::StartProfiling", "V8.InvokeApiInterruptCallbacks"):
        profiler_events.append((ts, tname, name, dur))
    if name in ("BeginImplFrameToSendBeginMainFrame", "SendBeginMainFrameToCommit",
                 "SubmitToReceiveCompositorFrame", "ReceiveCompositorFrameToStartDraw",
                 "SubmitCompositorFrameToPresentationCompositorFrame",
                 "SwapEndToPresentationCompositorFrame", "EndActivateToSubmitCompositorFrame",
                 "BeginFrame", "DrawFrame", "RasterTask", "Commit", "ActivateTreeAction"):
        pipeline[name] += dur
        pipeline_n[name] += 1
    if ph != "X":
        continue
    if tname is None:
        continue

    if name == "FireAnimationFrame":
        raf_durs.append((ts, dur))
    if name == "AnimationFrame":
        anim_durs.append((ts, dur))

    if abs(ts - STALL_TS) < 600_000 and key == (38564, 38752):
        stall_window_events.append((ts, name, dur))

    st = stacks[key]
    while st and st[-1]["end"] <= ts:
        done = st.pop()
        th_self[tname][done["name"]] += done["dur"] - done["child"]
    if not st:
        roots[tname].append((ts, dur, name))
    else:
        st[-1]["child"] += dur
    th_total[tname][name] += dur
    th_count[tname][name] += 1
    st.append({"ts": ts, "end": ts + dur, "name": name, "dur": dur, "child": 0})

for key, st in stacks.items():
    tname = THREADS.get(key, str(key))
    while st:
        done = st.pop()
        th_self[tname][done["name"]] += done["dur"] - done["child"]

def ms(u): return u / 1000.0

print("=" * 70)
print(f"DROPPED FRAMES (all threads): {len(drops)}")
print("=" * 70)
drop_threads = Counter(d[1] for d in drops)
print("by thread:", dict(drop_threads))
for ts, tn, dur, args in drops[:20]:
    print(f"  @ {ms(ts-T0):>9.1f} ms  {tn:<14} dur={ms(dur):>6.1f}  {args}")

for tn in ("Compositor", "CrGpuMain", "VizCompositor"):
    print("\n" + "=" * 70)
    print(f"{tn}: TOP 15 BY TOTAL DURATION")
    print("=" * 70)
    for nm, d in th_total[tn].most_common(15):
        print(f"  total {ms(d):>9.1f} ms  self {ms(th_self[tn][nm]):>8.1f} ms  n={th_count[tn][nm]:>7}  {nm}")
    long_ones = sorted([r for r in roots[tn] if r[1] >= 8000], key=lambda r: -r[1])[:10]
    print(f"  -- root tasks >=8ms: {sum(1 for r in roots[tn] if r[1] >= 8000)} total; worst:")
    for ts, dur, nm in long_ones:
        print(f"     @ {ms(ts-T0):>9.1f} ms  {ms(dur):>8.1f} ms  {nm}")

print("\n" + "=" * 70)
print("FRAME PIPELINE STAGE TOTALS (microseconds->ms)")
print("=" * 70)
for nm, d in pipeline.most_common():
    n = pipeline_n[nm]
    print(f"  total {ms(d):>9.1f} ms  avg {ms(d)/max(n,1):>6.2f} ms  max-check-below  n={n:>6}  {nm}")

print("\n" + "=" * 70)
print("RAF CALLBACK DURATION HISTOGRAM (FireAnimationFrame, main thread)")
print("=" * 70)
hist = Counter()
for ts, dur in raf_durs:
    d = dur / 1000.0
    if d < 2: bk = "<2ms"
    elif d < 4: bk = "2-4ms"
    elif d < 8: bk = "4-8ms"
    elif d < 16: bk = "8-16ms"
    elif d < 50: bk = "16-50ms"
    else: bk = ">50ms"
    hist[bk] += 1
for bk in ["<2ms", "2-4ms", "4-8ms", "8-16ms", "16-50ms", ">50ms"]:
    print(f"  {bk:>8}: {hist[bk]}")
print("\n15 worst rAF callbacks:")
for ts, dur in sorted(raf_durs, key=lambda x: -x[1])[:15]:
    print(f"  @ {ms(ts-T0):>9.1f} ms  {ms(dur):>8.1f} ms")

print("\nAnimationFrame (whole frame) duration histogram:")
hist2 = Counter()
for ts, dur in anim_durs:
    d = dur / 1000.0
    if d < 4: bk = "<4ms"
    elif d < 8: bk = "4-8ms"
    elif d < 16: bk = "8-16ms"
    elif d < 33: bk = "16-33ms"
    else: bk = ">33ms"
    hist2[bk] += 1
for bk in ["<4ms", "4-8ms", "8-16ms", "16-33ms", ">33ms"]:
    print(f"  {bk:>8}: {hist2[bk]}")
print("10 worst AnimationFrame entries:")
for ts, dur in sorted(anim_durs, key=lambda x: -x[1])[:10]:
    print(f"  @ {ms(ts-T0):>9.1f} ms  {ms(dur):>8.1f} ms")

print("\n" + "=" * 70)
print("PROFILER / INTERRUPT EVENTS")
print("=" * 70)
for ts, tn, nm, dur in sorted(profiler_events):
    print(f"  @ {ms(ts-T0):>9.1f} ms  {tn}  {nm}  dur={ms(dur):.1f} ms")

print("\n" + "=" * 70)
print("RAW UpdateCounters samples")
print("=" * 70)
for ph, a in update_counter_raw:
    print(f"  ph={ph} {a}")

print("\n" + "=" * 70)
print("MAIN-THREAD EVENTS AROUND THE 305ms STALL (window +/-600ms)")
print("=" * 70)
for ts, nm, dur in sorted(stall_window_events):
    if dur >= 1000 or nm in ("DroppedFrame",):
        print(f"  @ {ms(ts-T0):>9.1f} ms  dur={ms(dur):>8.1f} ms  {nm}")

print("\nDropped frames within +/-700ms of stall:")
for ts, tn, dur, args in drops:
    if abs(ts - STALL_TS) < 700_000:
        print(f"  @ {ms(ts-T0):>9.1f} ms  {tn}  {args}")
