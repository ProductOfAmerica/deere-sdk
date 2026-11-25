/**
 * Enum values kept after John Deere stopped listing them, applied by
 * scripts/fix-specs.ts.
 *
 * When Deere replaces an enum value in its documents and nobody can measure
 * whether the API still accepts it, dropping it from the generated types breaks
 * every caller that passes it: a major-version change made on no evidence. An
 * entry keeps the value beside the one Deere lists instead, until the major
 * named by `removeInMajor`; tests/spec-retained-enums.test.ts fails once
 * package.json reaches it. For one enum value, this is what a relocation
 * (spec-relocations.ts) is for an operation.
 *
 * Every entry is a claim about Deere's document, checked on every run:
 *
 *   - the enum lists the value again          -> skipped: nothing is added. If
 *     the replacement went at the same time, the signature check stops the run.
 *   - the parameter or its enum is gone       -> throw
 *   - the operations referencing the parameter are not the ones listed -> throw.
 *     The value is kept for those methods' callers; a method Deere adds would
 *     otherwise get it too, in a run the sync releases with nobody looking.
 *   - the enum lists neither the value nor the replacement -> throw
 */

import { isDeepStrictEqual } from 'node:util';
import { opKey } from './api-surface.js';
import { OPERATION_METHODS } from './contract-continuity.js';
import { isRecord } from './spec-utils.js';

export interface RetainedEnumValue {
  /** Spec the entry applies to. The same parameter in another spec is never touched. */
  spec: string;
  /** The `components.parameters` entry whose schema owns the enum. */
  parameter: string;
  /** Every operation that references the parameter, as "METHOD /path". */
  operations: readonly string[];
  /** The value John Deere stopped listing. It stays in the enum until `removeInMajor`. */
  value: string;
  /** The value John Deere lists in its place. */
  replacement: string;
  /** Date the change was first seen in a fetch. */
  observed: string;
  /** What was observed, and what was not, so the claim can be re-checked. */
  evidence: string;
  /** The package major that deletes this entry, and with it the value. */
  removeInMajor: number;
}

/** Extension stamped on a schema whose enum carries values John Deere no longer lists. */
export const RETAINED_ENUM_VALUES_KEY = 'x-retained-enum-values';

export const RETAINED_ENUM_VALUES: readonly RetainedEnumValue[] = [
  {
    spec: 'equipment',
    parameter: 'Embed',
    operations: ['GET /equipment/{id}'],
    value: 'capabilities',
    replacement: 'capabilities.Connectivity',
    observed: '2026-11-24',
    evidence:
      'The enum listed "capabilities" through the sync of 2026-11-23, which passed with it ' +
      "pinned in getEquipment's signature. The fetch of 2026-11-24 lists " +
      '"capabilities.Connectivity" in its place, with info.version still 2.0. Only the ' +
      'document change was observed: whether the live API accepts either value was not ' +
      'measured.',
    removeInMajor: 4,
  },
];

/** Each operation that references the parameter itself or through its path item. */
function referrers(spec: Record<string, unknown>, parameter: string): string[] {
  const ref = `#/components/parameters/${parameter}`;
  const refers = (list: unknown) =>
    Array.isArray(list) && list.some((item) => isRecord(item) && item.$ref === ref);
  const found: string[] = [];
  for (const [path, item] of Object.entries(isRecord(spec.paths) ? spec.paths : {})) {
    if (!isRecord(item)) continue;
    // Only methods generate-sdk emits: no other operation reaches a caller.
    for (const method of OPERATION_METHODS) {
      const op = item[method];
      if (isRecord(op) && (refers(item.parameters) || refers(op.parameters))) {
        found.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return found;
}

/** Operation identity, so a renamed path parameter is still the same operation. */
function identity(operation: string): string {
  const [method = '', path = ''] = operation.split(' ');
  return opKey(method, path);
}

/** Apply `entries` to one spec, as the header describes. Returns the number of values put back. */
export function retainEnumValues(
  spec: Record<string, unknown>,
  specName: string,
  entries: readonly RetainedEnumValue[] = RETAINED_ENUM_VALUES
): number {
  let retained = 0;
  for (const entry of entries) {
    if (entry.spec !== specName) continue;

    const at = ['components', 'parameters', entry.parameter, 'schema'];
    const mismatch = (found: string) =>
      new Error(
        `retainEnumValues: ${specName} ${at.join('/')} ${found}. Its RETAINED_ENUM_VALUES entry ` +
          `keeps "${entry.value}" beside "${entry.replacement}" for ` +
          `${entry.operations.join(', ')}. Re-read the document, then update the entry or ` +
          `delete it; deleting it drops "${entry.value}" from the generated types, a ` +
          `major-version change.`
      );

    let node: unknown = spec;
    for (const key of at) {
      node = isRecord(node) ? node[key] : undefined;
    }
    if (!isRecord(node) || !Array.isArray(node.enum)) throw mismatch('has no enum');

    const values: unknown[] = node.enum;
    if (values.includes(entry.value)) continue;

    const using = referrers(spec, entry.parameter);
    if (!isDeepStrictEqual(using.map(identity).sort(), entry.operations.map(identity).sort())) {
      throw mismatch(
        `is referenced by ${using.length > 0 ? using.join(', ') : 'no operation'} (when Deere ` +
          `renamed an operation's path, repoint it in this entry's operations and in the ` +
          `manifest entry's op:)`
      );
    }
    if (!values.includes(entry.replacement)) throw mismatch(`lists ${JSON.stringify(values)}`);

    const index = values.indexOf(entry.replacement);
    node.enum = [...values.slice(0, index), entry.value, ...values.slice(index)];
    const stamped = node[RETAINED_ENUM_VALUES_KEY];
    node[RETAINED_ENUM_VALUES_KEY] = [...(Array.isArray(stamped) ? stamped : []), entry.value];
    retained += 1;
  }
  return retained;
}
