'use strict';

// Zero-dependency unit tests for the ALG-14 prompt-construction layer.
// Run: `node --test deploy/tts-proxy/` (Node >= 18). No network, no API key needed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTotals, buildUserPrompt, cleanForSpeech, pickCanned, CATEGORIES, SYSTEM_PROMPT,
} = require('./absolution');

const ids = (cats) => cats.map((c) => c.id);

test('CATEGORIES is the canonical ten-row id/label list', () => {
  assert.equal(CATEGORIES.length, 10);
  for (const c of CATEGORIES) {
    assert.ok(c.id && c.label, `row missing field: ${JSON.stringify(c)}`);
    assert.match(c.id, /^[a-z0-9_]+$/);
  }
});

test('normalizeTotals: canonical ids (envelope)', () => {
  const out = normalizeTotals({ punched: ['benefiting_from_underpaid_labor', 'taking_more_than_needed'] });
  // deduped + returned in SCHEDULE order, not input order
  assert.deepEqual(ids(out), ['taking_more_than_needed', 'benefiting_from_underpaid_labor']);
});

test('normalizeTotals: 1-based schedule indices', () => {
  assert.deepEqual(ids(normalizeTotals([1, 5, 9])), [
    'taking_more_than_needed', 'benefiting_from_underpaid_labor', 'consuming_faster_than_things_renew',
  ]);
});

test('normalizeTotals: labels are case/space/punctuation insensitive', () => {
  const out = normalizeTotals(['  taking more than needed ', 'PRICING WHAT SHOULD NOT BE SOLD']);
  assert.deepEqual(ids(out), ['taking_more_than_needed', 'pricing_what_should_not_be_sold']);
});

test('normalizeTotals: flat map, truthy = punched, falsey = ignored', () => {
  const out = normalizeTotals({
    taking_more_than_needed: true,
    using_more_than_your_share: 1,
    letting_others_bear_the_cost: 0,     // not punched
    claiming_what_belongs_to_many: false, // not punched
    wanting_what_was_sold_to_you: '1',
  });
  assert.deepEqual(ids(out), [
    'taking_more_than_needed', 'using_more_than_your_share', 'wanting_what_was_sold_to_you',
  ]);
});

test('normalizeTotals: list of objects (count gates; no-count object = punched)', () => {
  const out = normalizeTotals({ categories: [
    { label: 'Taking more than needed', count: 3 },   // counts treated as boolean
    { id: 'using_more_than_your_share', count: 0 },     // not punched
    { name: 'CONSUMING FASTER THAN THINGS RENEW' },     // no count -> punched
  ] });
  assert.deepEqual(ids(out), ['taking_more_than_needed', 'consuming_faster_than_things_renew']);
});

test('normalizeTotals: dedupes repeats and drops unknowns; empty/garbage -> []', () => {
  assert.deepEqual(ids(normalizeTotals([1, 1, 'taking_more_than_needed', 'not_a_category', 99])),
    ['taking_more_than_needed']);
  assert.deepEqual(normalizeTotals(null), []);
  assert.deepEqual(normalizeTotals({}), []);
  assert.deepEqual(normalizeTotals('nonsense'), []);
  assert.deepEqual(normalizeTotals([]), []);
});

test('buildUserPrompt: blank card states no harm was declared, with no list rows', () => {
  const p = buildUserPrompt(normalizeTotals([]));
  assert.match(p, /no category of harm/i);
  assert.ok(!p.includes('- '));
});

test('buildUserPrompt: lists the declared harms in schedule order, no offsets', () => {
  const p = buildUserPrompt(normalizeTotals([5, 1])); // out of order in -> schedule order out
  const iTaking = p.indexOf('TAKING MORE THAN NEEDED');
  const iLabor = p.indexOf('BENEFITING FROM UNDERPAID LABOR');
  assert.ok(iTaking >= 0 && iLabor >= 0 && iTaking < iLabor, 'labels present and in schedule order');
  assert.ok(!p.includes('->'), 'no offset arrows');
  assert.match(p, /categories of harm/i);
  assert.doesNotMatch(p, /absolv/i); // the word andy flagged as triggering Magisterium's refusal
});

test('SYSTEM_PROMPT: currently empty (experiment) — only the declared harms are sent to the model', () => {
  assert.equal(SYSTEM_PROMPT, '');
});

test('cleanForSpeech: strips markup/footnotes and caps at a sentence boundary under maxChars', () => {
  const dirty = '## Heading\n- **bold** item [^1]\n[^1]: a footnote\n> quote with [link](http://x) and “smart” quotes';
  const out = cleanForSpeech(dirty, 600);
  for (const bad of ['##', '**', '[^1]', '](http', '“', '”', '\n']) assert.ok(!out.includes(bad), `should strip ${bad}`);
  const long = ('This is a sentence. ').repeat(80);
  const capped = cleanForSpeech(long, 200);
  assert.ok(capped.length <= 200);
  assert.match(capped, /\.$/); // ends on a sentence boundary
});

test('pickCanned: returns an on-register fallback string for any selection', () => {
  for (const sel of [[], [1], [1, 5, 9], CATEGORIES.map((_, i) => i + 1)]) {
    const line = pickCanned(normalizeTotals(sel));
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 0);
    assert.match(line, /absolv|No record is kept/);
  }
});
