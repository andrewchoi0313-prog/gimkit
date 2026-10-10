const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../src/questions.js');

// Small deterministic PRNG (mulberry32) so failures are reproducible.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertWellFormed(q) {
  assert.equal(q.choices.length, 4, q.prompt);
  assert.equal(new Set(q.choices).size, 4, `duplicate choices: ${q.prompt}`);
  assert.ok(q.answerIndex >= 0 && q.answerIndex < 4, q.prompt);
}

test('trivia entries have one answer and three distinct wrong answers', () => {
  for (const t of Q.TRIVIA) {
    assert.equal(t.wrong.length, 3, t.prompt);
    assert.equal(new Set([t.answer, ...t.wrong]).size, 4, t.prompt);
  }
  assert.equal(new Set(Q.TRIVIA.map((t) => t.prompt)).size, Q.TRIVIA.length, 'duplicate prompts');
});

test('math questions have the right answer among non-negative choices', () => {
  const rng = seeded(1);
  for (let i = 0; i < 2000; i++) {
    const q = Q.makeMathQuestion(rng);
    assertWellFormed(q);
    const [, a, op, b] = q.prompt.match(/^What is (\d+) (.) (\d+)\?$/);
    const x = Number(a);
    const y = Number(b);
    const expected = { '+': x + y, '−': x - y, '×': x * y, '÷': x / y }[op];
    assert.equal(q.choices[q.answerIndex], String(expected), q.prompt);
    for (const c of q.choices) assert.ok(Number(c) >= 0, q.prompt);
  }
});

test('question source mixes trivia and math and keeps producing questions', () => {
  const source = Q.createQuestionSource(seeded(7));
  const prompts = new Set();
  let math = 0;
  for (let i = 0; i < 500; i++) {
    const q = source.next();
    assertWellFormed(q);
    if (q.prompt.startsWith('What is ') && /\d/.test(q.prompt)) math++;
    else prompts.add(q.prompt);
  }
  assert.ok(math > 150 && math < 350, `math count ${math}`);
  assert.equal(prompts.size, Q.TRIVIA.length, 'every trivia question comes up');
});
