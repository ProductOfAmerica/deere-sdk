import assert from 'node:assert';
import { describe, it } from 'node:test';
import { isDocumentationKey, sanitizePropertyKey } from '../scripts/lib/spec-utils.js';

describe('fix-specs utilities', () => {
  describe('isDocumentationKey', () => {
    it('detects keys wrapped entirely in HTML tags', () => {
      assert.strictEqual(isDocumentationKey('<b>Location</b>'), true);
      assert.strictEqual(isDocumentationKey('<b>Identity</b>'), true);
      assert.strictEqual(isDocumentationKey('<span>Section</span>'), true);
    });

    it('rejects normal property keys', () => {
      assert.strictEqual(isDocumentationKey('createdTime'), false);
      assert.strictEqual(isDocumentationKey('id'), false);
      assert.strictEqual(isDocumentationKey('type'), false);
    });

    it('rejects keys with embedded HTML (not fully wrapped)', () => {
      assert.strictEqual(isDocumentationKey('createdTime<sup>DEPRECATED</sup>'), false);
      assert.strictEqual(isDocumentationKey('type<sup><a href="#foo">1</a></sup>'), false);
    });
  });

  describe('sanitizePropertyKey', () => {
    it('strips DEPRECATED markers', () => {
      assert.strictEqual(sanitizePropertyKey('createdTime<sup>DEPRECATED</sup>'), 'createdTime');
      assert.strictEqual(sanitizePropertyKey('referenceId<sup>DEPRECATED</sup>'), 'referenceId');
      assert.strictEqual(sanitizePropertyKey('timeRange<sup>DEPRECATED</sup>'), 'timeRange');
    });

    it('strips footnote references with nested anchor tags', () => {
      assert.strictEqual(
        sanitizePropertyKey("createdTime<sup><a href='#additional-date-time'>2</a></sup>"),
        'createdTime'
      );
      assert.strictEqual(
        sanitizePropertyKey("type<sup><a href='#additional-type'>1</a></sup>"),
        'type'
      );
      assert.strictEqual(
        sanitizePropertyKey("fieldOperationType<sup><a href='#field-operation-additional'>1</a></sup>"),
        'fieldOperationType'
      );
    });

    it('strips footnotes with double quotes in href', () => {
      assert.strictEqual(
        sanitizePropertyKey('severity<sup><a href="#event-severity">1</a></sup>'),
        'severity'
      );
    });

    it('leaves clean keys unchanged', () => {
      assert.strictEqual(sanitizePropertyKey('createdTime'), 'createdTime');
      assert.strictEqual(sanitizePropertyKey('id'), 'id');
      assert.strictEqual(sanitizePropertyKey('name'), 'name');
    });

    it('handles multiple sup tags (edge case)', () => {
      assert.strictEqual(
        sanitizePropertyKey('field<sup>1</sup><sup>2</sup>'),
        'field'
      );
    });

    it('strips standalone tags after sup removal', () => {
      assert.strictEqual(
        sanitizePropertyKey('field<b>bold</b>'),
        'fieldbold'
      );
    });
  });
});
