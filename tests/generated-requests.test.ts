/**
 * What a generated method hands the client, checked by running one.
 *
 * tests/generated-structure.test.ts pins the shape of every generated call.
 * This runs the one method that had the wrong shape, because the defect was
 * in what reached the wire. For a write with no declared request body the
 * generator left the body argument out, so the caller's options landed in
 * its place: they were sent to John Deere as the request body, and none of
 * them was applied.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Deere } from '../src/deere.js';
import { mockWithSpy } from './helpers/mock-fetch.js';

function recordingSdk() {
  const { fetch, calls } = mockWithSpy({});
  const deere = new Deere({ accessToken: 't', fetch, environment: 'api', maxRetries: 0 });
  return { deere, calls };
}

describe('a generated write method with no request body', () => {
  // PUT /fileResources/{id} declares none. Should John Deere add one, the
  // method's pinned signature changes and the sync stops for a person, who
  // then has this test to update as well.
  it('applies the options it is given, and does not send them as the body', async () => {
    const { deere, calls } = recordingSdk();

    await deere.mapLayers.updateFileResources('f1', { headers: { 'X-Probe': '1' } });

    assert.strictEqual(calls.length, 1);
    const { method, body, headers } = calls[0].init;
    // Compared together, so that a failure shows both halves of the defect.
    assert.deepStrictEqual(
      { method, body, probeHeader: (headers as Record<string, string>)['X-Probe'] },
      { method: 'PUT', body: undefined, probeHeader: '1' }
    );
  });

  it('sends no body when it is given no options either', async () => {
    const { deere, calls } = recordingSdk();

    await deere.mapLayers.updateFileResources('f1');

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].init.body, undefined);
  });
});
