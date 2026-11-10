# Character Control Architecture

## Status

- Target branch: `mvp`
- Status: architecture baseline and migration contract; implementation is incremental.
- Scope: the world sandbox player controller only. Do not rewrite the campus scene, model runtime, camera rig, or Rapier world ownership.

## Current implementation findings

1. `InputController` currently owns browser input listeners, held-key state, camera-relative movement calculation, navigation, jump buffering, coyote time, vertical velocity, Rapier character commands, render-position synchronization, and a legacy raycast/CollisionWorld movement path.
2. `PhysicsRuntime` owns the Rapier world and fixed-step accumulator. It also stores commanded velocity, acceleration, grounded state, actual velocity, and interpolation snapshots for the kinematic character.
3. `PlayerCharacterRuntime` is already presentation-oriented: it mounts the visual model and updates animation. Preserve this boundary.
4. The engine currently calls `input.update(renderDelta)`, then `physicsRuntime.step(renderDelta)`, then synchronizes the player visual anchor. This submits intent before the Rapier step, but jump-window timers and some controller decisions still advance on render delta rather than the fixed simulation clock.
5. The Rapier path and legacy CollisionWorld/raycast path coexist in `InputController`. The sandbox must select one authoritative movement path; legacy traversal remains only for explicit compatibility callers until its consumers are identified.

## Target ownership

### Input System
- Owns DOM event subscription lifecycle and physical/virtual device state.
- Publishes an immutable per-frame input snapshot: directional axes, run held, jump pressed edge, reset pressed edge.
- Clears held input on blur and document visibility loss.
- Does not calculate world velocity, gravity, collision, or player position.

### Character Motor
- Owns character locomotion policy: camera-relative direction, walk/run speed, jump buffer, coyote time, vertical velocity policy, and locomotion state.
- Consumes input snapshots and the authoritative physics contact state.
- Submits desired character velocity/acceleration to the physics runtime.
- Does not listen to DOM events or update visual meshes.

### Physics Runtime
- Owns Rapier bodies/controllers, fixed timestep, collision solving, grounded/contact result, and authoritative world-space transform.
- Advances simulation only in fixed substeps.
- Exposes read-only snapshots for presentation and diagnostics.
- Must not read keyboard state or know about animation.

### Character Presentation
- Owns model/animation selection, visual facing, and render interpolation.
- Consumes the physics snapshot and locomotion state.
- Must not write back to the authoritative physics transform or invent independent root-motion displacement.

## Migration sequence

1. Establish this ownership contract and preserve a working baseline.
2. Extract browser/device state into an Input System with focused unit tests.
3. Extract Rapier locomotion and jump policy from InputController into Character Motor. Keep a narrow compatibility facade while callers migrate.
4. Move jump/coyote timers and motor state transitions onto fixed simulation substeps. Input edges must be buffered across render frames so a short press is not lost between physics ticks.
5. Make the sandbox's Rapier path authoritative; isolate or remove legacy CollisionWorld movement only after repository-wide call-site verification.
6. Add regression coverage for held input, repeated press/release, W+Shift+Space, blur/focus, 60/120/144Hz render cadence, wall blocking, slopes, autostep, landing, and reset/teleport.
7. Verify CI and real-browser behavior separately. A green unit suite is not a substitute for browser input and collision acceptance.

## Non-goals and safeguards

- Do not add arbitrary delays to make input appear responsive.
- Do not change movement speed, jump height, gravity, collider dimensions, or traversal limits merely to hide symptoms.
- Do not run two movement solvers for the same sandbox character.
- Do not make animation root motion authoritative for the Rapier character.
- Do not remove legacy code until all consumers and tests are identified.
- Do not claim browser acceptance without actually running the browser scenarios.
