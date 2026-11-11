# Phase-1 evidence gathering: overview of a Chrome DevTools trace (streaming, read-only).
# Usage: python -I 01_overview.py <trace.json>
import json
import sys
from collections import Counter, defaultdict

path = sys.argv[1]

thread_names = {}   # (pid, tid) -> name
process_names = {}  # pid -> name
per_thread = Counter()
name_counts = Counter()
global_name_counts = Counter()
ts_min = None
ts_max = 0
total_events = 0
bad_lines = 0

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
            e = json.loads(s)
        except Exception:
            bad_lines += 1
            continue
        total_events += 1
        pid = e.get("pid")
        tid = e.get("tid")
        name = e.get("name", "?")
        ph = e.get("ph")
        ts = e.get("ts")
        global_name_counts[name] += 1
        if ph == "M":
            if name == "thread_name":
                thread_names[(pid, tid)] = e.get("args", {}).get("name", "?")
            elif name == "process_name":
                process_names[pid] = e.get("args", {}).get("name", "?")
            continue
        key = (pid, tid)
        per_thread[key] += 1
        if isinstance(ts, int):
            if ts_min is None or ts < ts_min:
                ts_min = ts
            end = ts + e.get("dur", 0)
            if end > ts_max:
                ts_max = end

print(f"total events: {total_events}, unparsed lines: {bad_lines}")
if ts_min is not None:
    print(f"trace span: {(ts_max - ts_min) / 1_000_000:.3f} s  ({ts_min} .. {ts_max})")
print("\n== processes ==")
for pid, nm in sorted(process_names.items(), key=lambda x: str(x)):
    print(f"  pid {pid}: {nm}")

print("\n== busiest threads ==")
for (pid, tid), cnt in per_thread.most_common(20):
    print(f"  pid={pid:<7} tid={tid:<7} events={cnt:<8} {thread_names.get((pid, tid), '?')}")

renderer_mains = [k for k, v in thread_names.items() if v == "CrRendererMain"]
print(f"\nCrRendererMain threads: {renderer_mains}")

# name counts on renderer main thread(s)
main_counter = Counter()
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
            e = json.loads(s)
        except Exception:
            continue
        if e.get("ph") == "M":
            continue
        if (e.get("pid"), e.get("tid")) in renderer_mains:
            main_counter[e.get("name", "?")] += 1

print(f"\n== event names on CrRendererMain ({len(main_counter)} distinct) ==")
for nm, cnt in main_counter.most_common():
    print(f"  {cnt:>8}  {nm}")

print("\n== frame/drop/gc related names (all threads) ==")
for nm, cnt in global_name_counts.most_common():
    low = nm.lower()
    if "frame" in low or "drop" in low or "gc" in low:
        print(f"  {cnt:>8}  {nm}")
