# Pinpoint the DOM teardown moment and list everything non-routine around it.
# Usage: python -I 12_teardown.py <trace.json>
import json
import sys

PATH = sys.argv[1]
T0 = 155202588394
MAIN = (38564, 38752)

ROUTINE = {"RunTask", "PageAnimator::serviceScriptedAnimations", "FireAnimationFrame",
           "v8::Debugger::AsyncTaskRun", "v8::Debugger::AsyncTaskScheduled",
           "v8::Debugger::AsyncTaskCanceled", "v8.callFunction", "FunctionCall",
           "AnimationFrame", "AnimationFrame::Render", "AnimationFrame::StyleAndLayout",
           "AnimationFrame::Script::Execute", "AnimationFrame::Presentation",
           "PrePaint", "Layerize", "Commit", "BeginMainThreadFrame", "BeginCommitCompositorFrame",
           "DrawingBuffer::prepareMailbox", "UpdateLayer", "SetLayerTreeId",
           "RequestAnimationFrame", "RequestMainThreadFrame", "UpdateCounters",
           "SoftNavigationContext::OnInputOrScroll", "SoftNavigation", "SoftNavigationContextCreated",
           "SoftNavigationHeuristics::SoftNavigationContextWasExhausted",
           "Responsiveness.Renderer.UserInteraction", "EventTiming", "PageTimingMetricsSender::SendNow",
           "V8.StackGuard", "V8.HandleInterrupts", "V8.BytecodeBudgetInterrupt",
           "V8.BytecodeBudgetInterruptWithStackCheck", "V8.DeoptimizeCode"}

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

print("UpdateCounters samples after 25.5s:")
prev = None
for e in event_iter(PATH):
    if e.get("name") != "UpdateCounters" or (e.get("pid"), e.get("tid")) != MAIN:
        continue
    r = rel(e["ts"])
    if r < 25500:
        continue
    d = e.get("args", {}).get("data", {})
    line = (r, d.get("jsHeapSizeUsed", 0) / 1e6, d.get("nodes"), d.get("jsEventListeners"), d.get("documents"))
    if line[2:] != prev:
        print(f"  @ {r:>8.1f} ms  heap={line[1]:.1f}MB nodes={line[2]} listeners={line[3]} docs={line[4]}  <-- CHANGED")
        prev = line[2:]

print("\nNon-routine main-thread events in 25.5s-26.5s:")
for e in event_iter(PATH):
    if (e.get("pid"), e.get("tid")) != MAIN:
        continue
    name = e.get("name", "?")
    r = rel(e["ts"])
    if not (25500 <= r <= 26500):
        continue
    if name in ROUTINE:
        # keep FunctionCall only if it isn't the rAF animate
        if name == "FunctionCall":
            fn = e.get("args", {}).get("data", {}).get("functionName")
            if fn == "animate":
                continue
        else:
            continue
    dur = e.get("dur", 0) or 0
    print(f"  @ {r:>8.1f} ms ph={e.get('ph')} dur={dur/1000:>6.2f} ms {name}  "
          f"{json.dumps(e.get('args', {}), ensure_ascii=False)[:220]}")
