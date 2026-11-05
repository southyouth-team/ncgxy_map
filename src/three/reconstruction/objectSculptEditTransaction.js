/**
 * Apply one ObjectSculptSpec edit as an atomic transaction.
 *
 * The source object is never mutated. The caller validates the complete candidate
 * before it becomes the editor's new state or enters the undo history.
 */
export function createObjectSculptEditTransaction(spec, edit, validate) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('ObjectSculptSpec 必须是对象');
  }
  if (typeof edit !== 'function') throw new TypeError('edit 必须是函数');
  if (typeof validate !== 'function') throw new TypeError('validate 必须是函数');

  const previousJson = JSON.stringify(spec);
  const previous = JSON.parse(previousJson);
  const candidate = JSON.parse(previousJson);
  edit(candidate);

  if (JSON.stringify(candidate) === previousJson) {
    return { changed: false, previous, spec: candidate };
  }

  validate(candidate);
  return { changed: true, previous, spec: candidate };
}
