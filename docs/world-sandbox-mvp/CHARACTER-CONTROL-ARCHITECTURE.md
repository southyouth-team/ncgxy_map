# Character Control Architecture

## Status

- Target branch: `mvp`
- Status: Input System extracted; Rapier Character Motor is wired to fixed-step lifecycle hooks; blank-sandbox movement explicitly requires Rapier. Unit and browser acceptance remains pending.
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
3. Extract Rapier locomotion and jump policy from InputController into Character Motor. Keep a narrow compatibility facade while callers migrate. (Initial extraction complete; see current limitations below.)
4. Move jump/coyote timers and motor state transitions onto fixed simulation substeps. (Implemented for the Rapier-backed sandbox path; cadence and contact-state verification remains pending.)
5. Make the sandbox's Rapier path authoritative; isolate or remove legacy CollisionWorld movement only after repository-wide call-site verification. (Explicit backend selection is implemented; legacy movement remains for campus compatibility.)
6. Add regression coverage for held input, repeated press/release, W+Shift+Space, blur/focus, 60/120/144Hz render cadence, wall blocking, slopes, autostep, landing, and reset/teleport.
7. Verify CI and real-browser behavior separately. A green unit suite is not a substitute for browser input and collision acceptance.

## Current extraction boundary\n\n- `CharacterMotor` is now the single owner of the Rapier character's jump buffer, coyote timer, jump lifecycle flags, vertical velocity, grounded snapshot, and Rapier velocity/acceleration command submission. `InputController` exposes temporary getter/setter compatibility aliases so existing UI, engine, and tests do not gain a second copy of those values.\n- `CharacterMotor` does not own DOM events, camera-relative axis calculation, pointer/touch look, or route planning. `InputController` continues to calculate the horizontal intent and passes the resulting displacement to the motor.\n- Rapier-backed sandbox Jump Buffer, Coyote Time, jump launch, gravity command submission, and landing reconciliation advance through fixed-step callbacks.\n- `InputController` now selects `rapier`, `collision-world`, or compatibility `auto` movement backend explicitly. The blank sandbox is configured as `rapier`; if its PhysicsRuntime is absent, movement returns without falling back to CollisionWorld/raycast.\n- The campus compatibility path explicitly selects `collision-world`; its existing support-surface/raycast behavior remains intact.\n- The CollisionWorld implementation is not deleted: it remains used by campus movement and by non-movement world systems such as legacy placement/obstacle queries.\n\n## Non-goals and safeguards

- Do not add arbitrary delays to make input appear responsive.
- Do not change movement speed, jump height, gravity, collider dimensions, or traversal limits merely to hide symptoms.
- Do not run two movement solvers for the same sandbox character.
- Do not make animation root motion authoritative for the Rapier character.
- Do not remove legacy code until all consumers and tests are identified.
- Do not claim browser acceptance without actually running the browser scenarios.


## Fixed-step lifecycle contract

- `PhysicsRuntime.step(frameDelta, hooks)` accepts optional `beforeFixedStep` and `afterFixedStep` callbacks.
- `beforeFixedStep` runs once immediately before each Rapier world step and receives the fixed delta, upcoming step count, and runtime reference. It is the intended place for Motor state transitions and command submission.
- `afterFixedStep` runs once after Rapier has advanced and character contact/transform snapshots have been refreshed. It receives the completed step count and is intended for Motor contact-state reconciliation.
- Hooks do not run on render frames that do not produce a fixed simulation step. A render frame that produces multiple catch-up steps invokes the hooks once per substep.
- Existing `step(frameDelta)` callers remain compatible. The sandbox engine now wires both hooks to `InputController`/`CharacterMotor` for normal simulation and stair-transition simulation.
- Hook exceptions are not swallowed. A `beforeFixedStep` exception prevents that simulation step; an `afterFixedStep` exception occurs after the step has been committed.


## CharacterMotor fixed-step ownership (implemented; validation pending)

- For the Rapier-backed sandbox character, render-frame `moveWithPhysics()` now only publishes the latest horizontal velocity intent and reads the interpolated presentation snapshot.
- Jump input is buffered immediately by the Motor. The buffer is consumed and decremented only in `beforeFixedStep`; Coyote Time is also advanced only there.
- `beforeFixedStep` is the only Rapier character command submission point for the Motor: it resolves jump launch, horizontal velocity, vertical velocity, and gravity acceleration.
- `afterFixedStep` reads the completed Rapier state and reconciles grounded, airborne, and landing transitions.
- `createCampusEngine` supplies these hooks to every sandbox physics step, including stair-transition frames.
- The legacy non-Rapier CollisionWorld path remains render-delta based and is intentionally outside this migration slice.
- Unit and browser verification is still required. In particular, confirm Rapier's computed-grounded semantics at launch and landing before considering the landing state machine complete.


## Backend isolation and current verification scope

- `createCampusEngine` configures `movementBackend: 'rapier'` for `blank-sandbox` and `movementBackend: 'collision-world'` for campus scenes.
- The controller's compatibility default remains `auto` for existing direct callers/tests; new engine construction must select a backend explicitly.
- Rapier-required mode fails closed: if the physics runtime is unavailable, the controller does not execute the legacy movement solver.
- CollisionWorld is retained for campus movement and spatial/placement compatibility. This migration isolates character movement ownership; it does not claim the entire CollisionWorld module is obsolete.
- Tests were added for fail-closed backend behavior, explicit legacy backend selection, and Coyote Time across 60/120/144 Hz render cadence. These tests have not yet been executed in a local checkout or verified by CI.
