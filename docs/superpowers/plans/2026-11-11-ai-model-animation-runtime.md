# AI Model Animation Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve AI-authored JavaScript/GLSL model animation across Worker restoration and connect it to the sandbox clock, environment, world state, preview, persistence and lifecycle.

**Architecture:** The existing Worker continues to build and serialize geometry. A host-owned model animation Runtime re-imports the already-persisted procedural source in the rendering context, invokes optional `createModelAnimation(THREE, model, context)`, and drives the returned controller with normalized frame/environment snapshots. Declarative visual animation records only protect target parts from static batching; no effect-type dispatcher remains.

**Tech Stack:** JavaScript ES modules, Three.js r180, Vue 3, Vite, Vitest, NestJS TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-11-11-ai-model-animation-runtime-design.md`

## Global Constraints

- Preserve AI freedom to combine Object3D transforms, geometry attributes, ShaderMaterial, onBeforeCompile and particles; do not introduce effect-category adapters.
- Use existing `proceduralModelSource`, environment state, model parameters and world state; do not create a second weather system or archive format.
- One host RAF per scene/preview; AI controllers never start their own loops.
- Isolate creation/update failures per model and dispose stale asynchronous controllers.
- Page-context generated animation execution is not a hardened security sandbox; do not claim otherwise.
- Old models without `createModelAnimation` remain static and require regeneration/AI edit.
- Do not commit or push unless the user explicitly asks.

## Review Focus

- Async creation finishing after replacement/disposal: stale controllers must be disposed without updating the replacement; covered by Runtime race tests in Task 1.
- One malformed controller throwing every frame: disable only that controller, report once and keep peers/scene running; covered by Runtime error tests in Task 1.
- Animated targets consumed by static batching before source loading: preserve declared target subtrees; covered by generic target tests in Task 2.
- Preview sharing materials/uniforms with a placed model: clone geometry/material/texture and dispose preview ownership; covered by preview helper tests in Task 4.
- Environment edited while a controller is alive: use the latest snapshot on every update rather than creation-time values; covered by Runtime environment tests in Task 1 and prompt assertions in Task 5.

---

### Task 1: Generic source-driven animation Runtime

**Files:**
- Replace: `src/three/engine/modelAnimationRuntime.js`
- Create: `src/three/engine/modelAnimationRuntime.test.js`
- Remove from `src/three/engine/waterVolumeRuntime.js`: all uncommitted water-wave adapter code; retain existing water-volume sensors.

**Interfaces:**
- Produces `createSandboxEnvironmentSnapshot(config): Readonly<EnvironmentSnapshot>`.
- Produces `createModelAnimationRuntime({ onError?, onActiveChange? }): { register(id, model), update(time, deltaTime, environment), remove(id), hasActiveAnimations(), dispose() }`.
- `register` reads `model.userData.proceduralModelSource`; optional module export is `createModelAnimation(THREE, model, context)`.
- Controller receives `update({ time, deltaTime, modelId, parameters, worldState, environment })` and optional `dispose()`.

- [ ] **Step 1: Write failing Runtime tests**

Cover normalized hour/weather/wind/artificial light and default/valid wind direction; real generated source creating a controller; latest environment/worldState/parameter values on each update; absent export returning inert; create/update error isolation; async remove/re-register/dispose races; idempotent cleanup; active-state notification.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/three/engine/modelAnimationRuntime.test.js`
Expected: FAIL because `createSandboxEnvironmentSnapshot` and `createModelAnimationRuntime` do not exist.

- [ ] **Step 3: Implement the generic Runtime**

Use the existing 120000-character source bound. Dynamically import a Blob module with a data-URL fallback and revoke temporary object URLs. Await the factory, validate `update`, keep per-model entries, catch/report creation/update/dispose failures, and immediately dispose controllers whose entry became stale. Freeze environment snapshots; clone parameter/world-state snapshots so generated code cannot mutate host records.

- [ ] **Step 4: Remove the obsolete water adapter tests/code**

Keep original water sensor tests unchanged in substance. Delete the uncommitted `waterSurfaces`/`waterWaves` shader implementation and its tests rather than translating them into another category adapter.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `npm test -- src/three/engine/modelAnimationRuntime.test.js src/three/engine/waterVolumeRuntime.test.js`
Expected: all tests pass.

### Task 2: Preserve arbitrary animated target subtrees during batching

**Files:**
- Modify: `src/three/sandbox/staticModelBatcher.js`
- Modify: `src/three/sandbox/staticModelBatcher.test.js`

**Interfaces:**
- Consumes generic `capabilities.visual.animations: [{ id, targetPartId }]` without reading an effect `type`.

- [ ] **Step 1: Replace the water-specific batching test with a generic animated-part test**

Use a declaration such as `{ id: 'motion-target', targetPartId: 'animated-part' }` with no effect type; assert collection and actual `batchStaticModel` preservation of that subtree while unrelated duplicate static meshes merge. Include a root-target case if the existing ancestor walk does not protect root descendants.

- [ ] **Step 2: Run and verify any new root-target case RED**

Run: `npm test -- src/three/sandbox/staticModelBatcher.test.js`
Expected: existing generic target collection passes; root-target preservation fails if root is currently excluded from the ancestor walk.

- [ ] **Step 3: Implement the minimum ancestor-walk correction**

Retain `addRecordsPartIds(ids, capabilities.visual?.animations)` and include the root when its componentId is an declared animation target. Do not add effect-specific rules.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- src/three/sandbox/staticModelBatcher.test.js`
Expected: all tests pass.

### Task 3: Main scene clock, environment and lifecycle integration

**Files:**
- Modify: `src/three/engine/createCampusEngine.js`
- Modify: `src/three/engine/modelAnimationRuntime.test.js` for any extracted integration helper that needs a test.

**Interfaces:**
- Consumes Task 1 Runtime and `createSandboxEnvironmentSnapshot`.
- Uses model key `userData.sandboxModelId` as Runtime ID.

- [ ] **Step 1: Add failing environment-direction integration tests at the pure snapshot boundary**

Assert partial `setEnvironment`-style config preserves the prior direction and invalid/zero direction does not produce NaN. Implement the smallest pure normalization helper needed if this behavior is not already covered in Task 1; run it RED before implementation.

- [ ] **Step 2: Wire model registration and cleanup**

Create one Runtime near `sandboxWaterVolumes`. Register after world-state/environment restoration and batching in both add and replace. Remove/dispose in the shared registration cleanup before old model resource disposal and during engine disposal. On controller failure call `console.warn` and optional `callbacks.onSandboxModelAnimationError`; on active change call `requestFrame`.

- [ ] **Step 3: Wire environment and frame updates**

Extend existing environment config with normalized `windDirection`, default `{ x: 1, z: 0 }`, preserving it when `setEnvironment` omits it. Each animation frame build one global snapshot, call Runtime `update(simulationTimeSeconds, delta, snapshot)`, invalidate dynamic shadows for active animations, and include active animations in `gateContinues`.

- [ ] **Step 4: Verify integration with targeted tests and compilation**

Run: `npm test -- src/three/engine/modelAnimationRuntime.test.js src/three/engine/waterVolumeRuntime.test.js src/three/sandbox/staticModelBatcher.test.js`
Run: `npm run build`
Expected: tests and build pass; browser visuals are not yet claimed.

### Task 4: Animated editor preview with isolated resources

**Files:**
- Modify: `src/components/ProceduralModelEditor.vue`
- Modify: `src/components/WorldSandboxMvp.vue`
- Modify: `src/three/engine/sandboxModelLifecycle.js`
- Create or modify: `src/three/engine/sandboxModelLifecycle.test.js`

**Interfaces:**
- Editor prop `environment` is the raw existing environment config; Runtime normalizes it.
- Produces `cloneSandboxObjectResources(root)` to clone geometry and material/texture ownership and `disposeSandboxObjectResources(root)` for preview-owned resources.

- [ ] **Step 1: Write failing preview resource-isolation tests**

Assert cloned meshes have distinct geometry/material/texture objects, structured-cloneable userData/source remains available, and disposal affects only clones. Run targeted lifecycle tests and verify RED because the whole-object helper is absent.

- [ ] **Step 2: Implement and verify resource helpers**

Reuse `cloneSandboxMaterial` and `disposeSandboxMaterial`; run lifecycle tests GREEN.

- [ ] **Step 3: Connect the preview Runtime**

Before removing an old preview call Runtime `remove('preview')`; clone resources, add the clone, then `register('preview', previewRoot)`. Drive it from the existing RAF with elapsed/delta seconds and the latest `props.environment`. Dispose on replacement/unmount before releasing cloned resources. Report preview animation errors to the existing editor error surface without stopping rendering.

- [ ] **Step 4: Provide current preview environment**

Compute the same effective raw config used by `updateEnvironment` in `WorldSandboxMvp.vue` from existing refs and pass it to `ProceduralModelEditor`; do not duplicate weather ownership.

- [ ] **Step 5: Verify targeted tests and compilation**

Run lifecycle/Runtime tests and `npm run build`; expect success.

### Task 5: General AI generation and editing contract

**Files:**
- Modify: `server/src/modules/assets/image-generation.service.ts`
- Modify: `server/src/modules/assets/image-generation.procedural.spec.ts`

**Interfaces:**
- Optional `createModelAnimation(THREE, model, context)` returning `{ update(frame), dispose?() }`.
- `visual.animations` contains target metadata only; the environment field names match Task 1 exactly.

- [ ] **Step 1: Replace obsolete water-type prompt assertions**

For both creation and editing, assert the prompt contains `createModelAnimation`, `frame.environment`, `environment.wind.speed`, `frame.worldState`, `capabilities.visual.animations`, no-own-RAF guidance, and arbitrary Shader/transform composition guidance. Remove `waterWaves`, `waterSurfaces` and horizontal-water recipe assertions.

- [ ] **Step 2: Run server prompt tests and verify RED**

Run: `npm --prefix server test -- --runInBand src/modules/assets/image-generation.procedural.spec.ts`
Expected: creation/editing tests fail because current prompts contain the old water-specific contract.

- [ ] **Step 3: Implement one shared general animation instruction block**

Use it in both new-model and edit prompts. Document exact context/frame/environment fields, current-values-per-update requirement, target declarations, resource disposal, visual-vs-static-collider boundary and source restrictions. Permit AI-authored ShaderMaterial/onBeforeCompile and transforms; prohibit only separate loops/renderers/cameras and existing network/DOM/global APIs. Remove water-specific prompts.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm --prefix server test -- --runInBand src/modules/assets/image-generation.procedural.spec.ts`
Expected: all tests pass.

### Task 6: Full verification and actual-result report

**Files:**
- Modify only files implicated by observed failures in this feature; report unrelated pre-existing failures separately.

- [ ] **Step 1: Run complete frontend tests**

Run: `npm test`
Expected: zero failures, or report every pre-existing failure by name and rerun the affected feature suites.

- [ ] **Step 2: Run frontend and server builds/tests**

Run: `npm run build`
Run: `npm --prefix server test -- --runInBand`
Run: `npm --prefix server run build`
Expected: record actual exit codes and failure names; do not infer build success from tests.

- [ ] **Step 3: Inspect final diff and remove abandoned intermediate work**

Confirm no `waterWaves`/`waterSurfaces` adapter or stale imports remain, no unrelated user files changed, no generated uploads/lockfiles added, and no commit/push occurred.

- [ ] **Step 4: Browser verification**

If a browser-driving route is available, generate/load a small source fixture with custom transform and Shader animation, change wind, save/restore and inspect preview/main scene. Otherwise explicitly state that Shader compilation and visual motion still require user-side browser verification and provide the exact regeneration/AI-edit requirement for old models.
