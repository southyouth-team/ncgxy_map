# Measure BeginFrame / frame presentation cadence and dropped-frame markers.
# rAF can stay on schedule while the compositor skips presents; this script
# looks at the display/BeginFrame layer instead of renderer-main timing.
# Usage: python -I 22_frame_presentation.py <trace.json>
import json
import sys
from collections import Counter, defaultdict

PATH = sys.argv[1]
T0 = 155202588394
WALK = (13100, 25800)
IDLE_TAIL = (26340, 27000)

thread_names = {}
process_names = {}
name_counter = Counter()
begin_frames = []          # (rel_ms, source thread)
presents = []              # FramePresented-ish events
drop_markers = []          # events whose name implies a dropped/missed frame


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
    ph = e.get("ph")
    if ph == "M":
        args = e.get("args", {})
        if e.get("name") == "process_name":
            process_names[e.get("pid")] = args.get("name", "")
        elif e.get("name") == "thread_name":
            thread_names[(e.get("pid"), e.get("tid"))] = args.get("name", "")
        continue
    name = e.get("name", "")
    low = name.lower()
    if any(token in low for token in ("frame", "beginframe", "present", "vsync", "dropped", "missed", "deadline")):
        name_counter[name] += 1
        r = (e["ts"] - T0) / 1000.0
        if "beginframe" in low or "vsync" in low:
            begin_frames.append((r, name, (e.get("pid"), e.get("tid"))))
        if "present" in low:
            presents.append((r, name, (e.get("pid"), e.get("tid"))))
        if any(token in low for token in ("dropped", "missed", "didnot")):
            drop_markers.append((r, name, (e.get("pid"), e.get("tid"))))

print("== frame-related event names (count) ==")
for name, count in name_counter.most_common(40):
    print(f"  {count:8d}  {name}")


def cadence(seq, window, label):
    lo, hi = window
    pts = sorted(r for r, *_ in seq if lo <= r < hi)
    print(f"\n== {label}: {len(pts)} events in {lo/1000:.1f}-{hi/1000:.1f}s ==")
    if len(pts) < 2:
        return
    gaps = [pts[i] - pts[i - 1] for i in range(1, len(pts))]
    gaps_sorted = sorted(gaps)
    n = len(gaps)
    under10 = sum(1 for g in gaps if g < 10.5)
    doubled = sum(1 for g in gaps if 14.5 <= g < 22.5)
    tripled = sum(1 for g in gaps if g >= 22.5)
    print(f"  gap ms: min={min(gaps):.2f} p50={gaps_sorted[n//2]:.2f} "
          f"p95={gaps_sorted[int(n*0.95)]:.2f} max={max(gaps):.2f}")
    print(f"  ~8.3ms(120Hz)={under10}  ~16.7ms(doubled)={doubled}  >=22.5ms={tripled}")
    # show the worst gaps with timestamps
    worst = sorted(zip(gaps, pts[1:]), reverse=True)[:12]
    if worst and worst[0][0] > 10.5:
        print("  worst gaps (gap_ms @rel_s):")
        for gap, at in worst:
            if gap > 10.5:
                print(f"    {gap:7.2f}ms @{at/1000:7.3f}s")


cadence(begin_frames, WALK, "BeginFrame/VSync during WALK")
cadence(begin_frames, IDLE_TAIL, "BeginFrame/VSync during IDLE TAIL")
cadence(presents, WALK, "PRESENT during WALK")
cadence(presents, IDLE_TAIL, "PRESENT during IDLE TAIL")

print(f"\n== drop/miss markers: {len(drop_markers)} ==")
by_name = Counter(name for _, name, _ in drop_markers)
for name, count in by_name.most_common(20):
    print(f"  {count:6d}  {name}")
for r, name, (pid, tid) in drop_markers[:20]:
    print(f"  @{r/1000:7.3f}s {name} [{process_names.get(pid)}::{thread_names.get((pid,tid))}]")
