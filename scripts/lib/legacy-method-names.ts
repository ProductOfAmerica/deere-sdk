/**
 * Legacy order-sensitive method naming, extracted verbatim from
 * generate-sdk.ts for the one-time api-surface manifest seed.
 *
 * Used only by scripts/seed-api-surface.ts. Scheduled for deletion once the
 * manifest lands. Do not use for live generation.
 */

import { toCamelCase, toPascalCase } from './spec-utils.js';

export interface LegacyNamedOp {
  operationId: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  isCollection: boolean;
}

export function inferLegacyMethodName(op: LegacyNamedOp): string {
  const id = (op.operationId || '').toLowerCase();

  if (id.startsWith('getall') || id.startsWith('list') || id.match(/^get[a-z]+s$/)) {
    return 'list';
  }
  if (id.startsWith('get') && !id.includes('all')) {
    return 'get';
  }
  if (id.startsWith('create') || (id.startsWith('post') && !id.includes('get'))) {
    return 'create';
  }
  if (id.startsWith('update') || id.startsWith('put')) {
    return 'update';
  }
  if (id.startsWith('delete') || id.startsWith('remove')) {
    return 'delete';
  }

  if (op.method === 'get') {
    return op.isCollection ? 'list' : 'get';
  }
  if (op.method === 'post') return 'create';
  if (op.method === 'put') return 'update';
  if (op.method === 'patch') return 'patch';
  if (op.method === 'delete') return 'delete';

  return toCamelCase(op.operationId || `${op.method}Unknown`);
}

export function resolveLegacyMethodNames(ops: LegacyNamedOp[]): Map<string, string> {
  const usedMethodNames = new Set<string>();
  const names = new Map<string, string>();

  for (const op of ops) {
    let methodName = inferLegacyMethodName(op);

    if (usedMethodNames.has(methodName)) {
      const pathParts = op.path.split('/').filter((p) => !p.startsWith('{') && p);
      const suffix = toPascalCase(pathParts[pathParts.length - 1] || 'Item');
      methodName = `${methodName}${suffix}`;

      let counter = 2;
      while (usedMethodNames.has(methodName)) {
        methodName = `${methodName}${counter}`;
        counter++;
      }
    }
    usedMethodNames.add(methodName);

    names.set(`${op.method.toUpperCase()} ${op.path}`, methodName);
  }

  return names;
}
