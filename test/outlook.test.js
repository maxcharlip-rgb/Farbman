'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseMentions, ping, configured } = require('../src/outlook');

test('parseMentions finds handles, dedupes, and expands @all', () => {
  assert.deepStrictEqual(parseMentions('hey @supervisor look at this @supervisor').map((p) => p.handle), ['supervisor']);
  assert.deepStrictEqual(parseMentions('@ALL please review').map((p) => p.handle).sort(), ['accountant', 'manager', 'max', 'ownerrep', 'supervisor']);
  assert.deepStrictEqual(parseMentions('no mentions here'), []);
  assert.deepStrictEqual(parseMentions('@unknownperson hi'), []);
});

test('ping is simulated (never throws) when Graph is not configured', async () => {
  assert.strictEqual(configured(), false);
  const r = await ping({ handle: 'manager', email: 'manager@farbman.example' }, { from: 'T', text: 'x', propertyName: null });
  assert.strictEqual(r.status, 'simulated');
});
