# When did sandbox-placement / overview mode begin vs GPU saturation start.
# Usage: python -I 16_mode_timing.py <trace.json>
import json
import sys

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)
GPU = (36484, 37024)

placement_hits = []
gpu_heavy = []

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
    if e.get("ph") != "X":
        continue
    r = (e["ts"] - T0) / 1000.0
    if (e.get("pid"), e.get("tid")) == MAIN and e.get("name") == "FunctionCall":
        fn = e.get("args", {}).get("data", {}).get("functionName", "")
        if "Sandbox" in fn or fn in ("CameraRig.onOverviewPanPointerMove",):
            placement_hits.append((r, fn))
    elif (e.get("pid"), e.get("tid")) == GPU and e.get("name") == "RunTask":
        d = e.get("dur", 0) / 1000.0
        if d >= 4:
            gpu_heavy.append((r, d))

names = sorted(set(fn for _, fn in placement_hits))
print("placement-related functions seen:", names)
for nm in names:
    ts = [r for r, f in placement_hits if f == nm]
    print(f"  {nm}: n={len(ts)} first=@{ts[0]:.1f}ms last=@{ts[-1]:.1f}ms")
print(f"\nGPU heavy tasks (>=4ms): n={len(gpu_heavy)}")
print("first 5:", [(round(r, 1), round(d, 1)) for r, d in gpu_heavy[:5]])
