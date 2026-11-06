# ObjectModelChangeSet 1.0

## Purpose

ObjectModelChangeSet is the server-side declarative mutation contract for ObjectModelSpec 3.0. AI proposes data changes; trusted server code applies them to an immutable baseline and validates the complete candidate. It does not accept JavaScript, TypeScript, callbacks, executable expressions outside the ObjectModelSpec expression AST, or model-authored builder code.

## Envelope

- `changeSetVersion`: exactly `1.0`.
- `baseRevision`: SHA-256 of canonical JSON for the exact baseline ObjectModelSpec. Object key order is normalized; array order remains significant.
- `changes`: 1-200 ordered declarative changes.

A stale revision is rejected before any mutation. The input baseline is never mutated. A candidate is returned only after the canonical ObjectModelSpec 3.0 validator accepts the entire result.

## Operations

| Type | Payload | Policy |
|---|---|---|
| `add-component` | `component` | New unique ID; parent must already exist |
| `replace-component` | `nodeId`, `component` | Replaces one node; its ID must remain unchanged |
| `remove-component` | `nodeId`, optional `cascade` | Root deletion forbidden; subtree deletion requires explicit `cascade: true` |
| `upsert-material` | `materialId`, `material` | Adds or replaces one material definition |
| `remove-material` | `materialId` | Refuses deletion while any component references the material |
| `replace-parameter-schema` | `parameterSchema` | Replaces the parameter declarations; canonical validator checks all targets and types |
| `replace-operations` | `operations` | Replaces declarative operations; canonical validator checks references and expansion budgets |

Operation type names are mutation verbs, not an object-category or geometry-primitive whitelist. New object types and registered geometry capabilities remain data-driven through ObjectModelSpec and the existing capability registry.

## Safety and atomicity

- JSON-only payloads; rejects prototype-polluting keys, non-finite numbers, unsupported fields, excessive nesting, and oversized payloads.
- At most 200 changes, 100 parameters, 40 operations, and the existing 300-component protocol budget.
- Every operation is applied to a private candidate copy.
- The canonical shared validator is run once more on the complete candidate.
- Any failure rejects the entire ChangeSet; no partial candidate is returned and the caller must not persist it.
- Result includes the new revision and affected component/material IDs.

## Integration boundary

This first P1.3 increment delivers the deterministic ChangeSet contract and tests. Existing AI generation and modification endpoints still return full ObjectModelSpec results; they are not yet migrated to emit this envelope. That integration is a separate follow-up within P1.3 and must retain full-spec validation as the final acceptance gate.
