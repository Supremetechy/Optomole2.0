/**
 * shared/DTOs.js — data-transfer object shapes + light factories/guards.
 *
 * Plain-JavaScript ES module. These describe the payloads that cross a boundary
 * (compiler → engine, API → client): the Semantic Mapping Manifest and its
 * envelope. The typedefs are JSDoc; the exported helpers are real runtime code
 * so callers can build and validate payloads without a schema library.
 */

/**
 * @typedef {import('./Types.js').SourceElement} SourceElement
 * @typedef {import('./Types.js').GameBinding} GameBinding
 */

/**
 * @typedef {Object} BindingDTO
 * @property {string} id
 * @property {SourceElement} sourceElement
 * @property {GameBinding} gameBinding
 */

/**
 * @typedef {Object} AssetSlotDTO
 * @property {string} id
 * @property {'image'|'audio'|'video'} type
 * @property {boolean} [required]
 * @property {string} [fallback]
 * @property {string} [url]
 */

/**
 * @typedef {Object} SemanticMappingManifestDTO
 * @property {string} schemaVersion
 * @property {string} id
 * @property {string} templateId
 * @property {string} experienceId
 * @property {string} title
 * @property {string} target
 * @property {string[]} [requiredRuntimeSystems]
 * @property {AssetSlotDTO[]} [assetSlots]
 * @property {BindingDTO[]} bindings
 */

/**
 * @typedef {Object} ExperienceEnvelopeDTO
 * The boot payload the browser engine accepts: a manifest plus display meta.
 * @property {SemanticMappingManifestDTO} manifest
 * @property {{ title?: string, subtitle?: string, briefing?: string, roomSize?: number, waveSize?: number }} [meta]
 */

export const SCHEMA_VERSION = '1.0.0';

/**
 * Build an experience envelope from a manifest (+ optional meta).
 * @param {SemanticMappingManifestDTO} manifest
 * @param {ExperienceEnvelopeDTO['meta']} [meta]
 * @returns {ExperienceEnvelopeDTO}
 */
export function createEnvelope(manifest, meta = {}) {
  return { manifest, meta: { title: manifest?.title, ...meta } };
}

/**
 * Minimal structural check that a value is a usable manifest. Returns a list of
 * problems (empty = valid) rather than throwing, so callers can decide.
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateManifest(value) {
  const errors = [];
  const m = /** @type {any} */ (value);
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  if (!m.templateId) errors.push('manifest.templateId is required');
  if (!Array.isArray(m.bindings)) errors.push('manifest.bindings must be an array');
  else {
    m.bindings.forEach((b, i) => {
      if (!b || typeof b !== 'object') errors.push(`bindings[${i}] is not an object`);
      else {
        if (!b.gameBinding?.gameEntityType) errors.push(`bindings[${i}].gameBinding.gameEntityType is required`);
        if (!b.sourceElement) errors.push(`bindings[${i}].sourceElement is required`);
      }
    });
  }
  return errors;
}

/** True when {@link validateManifest} finds no problems. */
export function isValidManifest(value) {
  return validateManifest(value).length === 0;
}

export {};
