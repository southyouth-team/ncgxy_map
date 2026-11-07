/**
 * Incremental procedural-model build protocol.
 *
 * This file defines transport data only. Generated source remains untrusted
 * and must execute inside the dedicated browser Worker.
 */

export type ModelBuildBounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

export type ModelBuildComponentPlan = {
  id: string;
  parentId?: string;
  dependsOn?: string[];
  purpose?: string;
  bounds?: ModelBuildBounds;
  [key: string]: unknown;
};

export type ModelBuildPlan = {
  version: 1;
  modelId: string;
  name: string;
  coordinateSystem: {
    upAxis: 'Y';
    units: 'scene';
    [key: string]: unknown;
  };
  components: ModelBuildComponentPlan[];
  modelCapabilityManifest?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ModelComponentChunk = {
  componentId: string;
  source: string;
  exports?: Record<string, unknown>;
};

export type ModelBuildEvent =
  | { type: 'plan'; plan: ModelBuildPlan }
  | { type: 'stage'; stage: string; label: string }
  | { type: 'single'; result: Record<string, unknown> }
  | { type: 'component-start'; componentId: string; index: number; total: number }
  | { type: 'component-complete'; componentId: string; index: number; total: number; chunk: ModelComponentChunk }
  | { type: 'assembly'; status: 'started' | 'complete' }
  | { type: 'validation'; diagnostics: unknown[] }
  | { type: 'complete'; modelId: string }
  | { type: 'error'; stage: string; componentId?: string; message: string };

/**
 * Resolve a deterministic build order from explicit parent/dependency edges.
 * Component categories and names are intentionally opaque to this function.
 * Original plan order is retained whenever multiple components are ready.
 */
export function resolveModelBuildOrder(plan: ModelBuildPlan): ModelBuildComponentPlan[] {
  if (!plan || !Array.isArray(plan.components)) {
    throw new TypeError('ModelBuildPlan.components must be an array');
  }

  const byId = new Map<string, ModelBuildComponentPlan>();
  const sourceIndex = new Map<string, number>();
  plan.components.forEach((component, index) => {
    if (!component || typeof component.id !== 'string' || !component.id.trim()) {
      throw new TypeError('Every model component requires a stable id');
    }
    if (byId.has(component.id)) {
      throw new Error('Duplicate model component id: ' + component.id);
    }
    byId.set(component.id, component);
    sourceIndex.set(component.id, index);
  });

  const dependencies = new Map<string, Set<string>>();
  for (const component of plan.components) {
    const edges = new Set<string>([
      ...(component.parentId ? [component.parentId] : []),
      ...(Array.isArray(component.dependsOn) ? component.dependsOn : []),
    ]);
    if (edges.has(component.id)) {
      throw new Error('Model component cannot depend on itself: ' + component.id);
    }
    for (const dependencyId of edges) {
      if (!byId.has(dependencyId)) {
        throw new Error('Unknown component dependency: ' + component.id + ' -> ' + dependencyId);
      }
    }
    dependencies.set(component.id, edges);
  }

  const completed = new Set<string>();
  const ordered: ModelBuildComponentPlan[] = [];
  while (ordered.length < plan.components.length) {
    const ready = plan.components
      .filter(component => !completed.has(component.id))
      .filter(component => [...(dependencies.get(component.id) || [])].every(id => completed.has(id)))
      .sort((a, b) => sourceIndex.get(a.id)! - sourceIndex.get(b.id)!);

    if (!ready.length) {
      const blocked = plan.components.filter(component => !completed.has(component.id)).map(component => component.id);
      throw new Error('Model component dependency cycle: ' + blocked.join(', '));
    }

    for (const component of ready) {
      completed.add(component.id);
      ordered.push(component);
    }
  }

  return ordered;
}
