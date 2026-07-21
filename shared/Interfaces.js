/**
 * shared/Interfaces.js — the runtime contracts each genre template implements.
 *
 * Plain-JavaScript ES module. JavaScript has no `interface` keyword, so these are
 * documented as JSDoc `@typedef`s (callback shapes) plus a runtime `implements()`
 * helper that checks an object exposes the required methods. This is what the
 * browser engine relies on: a template runtime is any object with `start()`, and
 * a scene is any object with `enter/update/exit`.
 */

/**
 * @typedef {Object} TemplateRuntime
 * A genre runtime handed to OptomoleRuntime.start(). Owns the scene flow.
 * @property {(runtime: any) => (Promise<any>|any)} start  Receives the runtime; sets the first scene.
 */

/**
 * @typedef {Object} Scene
 * A unit in the SceneManager stack.
 * @property {any} container                        Its PIXI display root.
 * @property {(ctx: any) => void} [enter]           Called when it becomes active.
 * @property {() => void} [exit]                     Called when removed (tear down DOM/physics here).
 * @property {(dt: number) => void} [update]         Per-frame, dt in seconds.
 * @property {(w: number, h: number) => void} [resize]
 */

/**
 * @typedef {Object} GenreEntityFactory
 * The mapping bridge each genre implements: EntitySpec → live game object.
 * @property {(ctx: any, spec: any, opts?: any) => any} [createEntity]  Build one entity from a spec.
 */

/** Required method names per contract, for the runtime {@link implements} check. */
export const Contracts = Object.freeze({
  TemplateRuntime: ['start'],
  Scene: ['enter', 'update'],
});

/**
 * Duck-typed contract check: does `obj` expose every method the named contract
 * requires? Returns the list of missing method names (empty = satisfies it).
 * @param {unknown} obj
 * @param {keyof typeof Contracts} contract
 * @returns {string[]}
 */
export function missingMembers(obj, contract) {
  const required = Contracts[contract] || [];
  const o = /** @type {any} */ (obj);
  if (!o) return [...required];
  return required.filter((name) => typeof o[name] !== 'function');
}

/**
 * @param {unknown} obj
 * @param {keyof typeof Contracts} contract
 * @returns {boolean}
 */
export function implementsContract(obj, contract) {
  return missingMembers(obj, contract).length === 0;
}

export {};
