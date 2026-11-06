/**
 * Shared ObjectModelSpec parameter-target resolver.
 *
 * This module is the single source of truth for resolving editable scalar
 * properties. It is protocol-only: it never mutates a model or executes code.
 */
export type ObjectModelParameterValueKind = 'number' | 'boolean' | 'color' | 'select';

export interface ResolvedObjectModelParameterTarget {
  kind: ObjectModelParameterValueKind;
  value?: unknown;
  domain: 'visibility' | 'geometry' | 'material' | 'transform' | 'dimensions' | 'geometryDescriptor';
}

const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const PROPERTY_PART_PATTERN = /^(?:[a-zA-Z][a-zA-Z0-9_]{0,39}|0|[1-9][0-9]{0,2})$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function valueKind(value: unknown): ObjectModelParameterValueKind | null {
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && COLOR_PATTERN.test(value)) return 'color';
  if (typeof value === 'string') return 'select';
  return null;
}

/**
 * Resolve a property against the current component/material data.
 * Unknown, non-scalar, unsafe, and unsupported paths return null.
 */
export function resolveObjectModelParameterTarget(
  node: any,
  materials: Record<string, any>,
  property: unknown,
): ResolvedObjectModelParameterTarget | null {
  if (!isRecord(node) || typeof property !== 'string' || property.length > 160) return null;
  const parts = property.split('.');
  if (!parts.length || parts.some(part => !PROPERTY_PART_PATTERN.test(part) || FORBIDDEN_PATH_PARTS.has(part))) return null;

  if (property === 'visibility.visible') {
    return { kind: 'boolean', value: node.hidden !== true, domain: 'visibility' };
  }
  if (property === 'geometry.primitive') {
    return typeof node.primitive === 'string'
      ? { kind: 'select', value: node.primitive, domain: 'geometry' }
      : null;
  }

  if (parts[0] === 'material') {
    if (parts.length !== 2 || typeof node.material !== 'string' || !isRecord(materials)) return null;
    const material = materials[node.material];
    if (!isRecord(material) || !Object.prototype.hasOwnProperty.call(material, parts[1])) return null;
    const value = material[parts[1]];
    const kind = valueKind(value);
    return kind ? { kind, value, domain: 'material' } : null;
  }

  if (parts[0] === 'transform') {
    if (parts.length !== 3 || !['position', 'rotation', 'scale'].includes(parts[1]) || !['x', 'y', 'z'].includes(parts[2])) return null;
    const index = 'xyz'.indexOf(parts[2]);
    const fallback = parts[1] === 'scale' ? 1 : 0;
    const vector = node.transform?.[parts[1]];
    const value = Array.isArray(vector) ? vector[index] : fallback;
    return Number.isFinite(Number(value))
      ? { kind: 'number', value: Number(value), domain: 'transform' }
      : null;
  }

  if (!['dimensions', 'geometryDescriptor'].includes(parts[0]) || parts.length < 2 || parts.length > 4) return null;
  let value: any = node[parts[0]];
  for (const part of parts.slice(1)) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || index > 127) return null;
      value = value[index];
    } else {
      if (!Object.prototype.hasOwnProperty.call(value, part)) return null;
      value = value[part];
    }
  }
  const kind = valueKind(value);
  return kind ? { kind, value, domain: parts[0] as 'dimensions' | 'geometryDescriptor' } : null;
}

/**
 * visibility.visible is boolean state when set directly, but accepts a numeric
 * parameter only when used as a distance threshold.
 */
export function isObjectModelParameterTargetTypeCompatible(
  parameterType: unknown,
  target: ResolvedObjectModelParameterTarget,
  mode: unknown = 'set',
  property?: unknown,
): boolean {
  if (property === 'visibility.visible' && ['visible-from', 'visible-through'].includes(String(mode))) {
    return parameterType === 'number';
  }
  return parameterType === target.kind;
}
