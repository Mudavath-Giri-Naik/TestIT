const assert = require('node:assert/strict');
const test = require('node:test');
const coach = require('../src/main/interviewCoach');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const pngDataUrl = `data:image/png;base64,${PNG_1PX}`;

function validOutput(overrides = {}) {
  const sections = coach.SECTION_IDS.map(id => ({ id, title: coach.DEFAULT_TITLES[id], blocks: [{ type: 'say', text: `About ${id}.` }] }));
  sections[3].blocks.push({ type: 'complexity', which: 'brute_force', time: 'O(n^2)', space: 'O(1)', why: 'Two loops.' });
  sections[4].blocks.push({ type: 'complexity', which: 'optimized', time: 'O(n)', space: 'O(n)', why: 'One pass with a hash map.' });
  sections[5].blocks.push({ type: 'code', language: 'Python', code: 'def f():\n    return 1\n' });
  return {
    error: null,
    problem_title: 'Two Sum',
    difficulty: 'Easy',
    language: 'Python',
    sections,
    comparison: {
      brute_force: { time: 'O(n^2)', space: 'O(1)' },
      optimized: { time: 'O(n)', space: 'O(n)' },
      improvement: 'For n = 10,000 that is 50 million checks down to 10,000.',
      ...overrides.comparison,
    },
    ...overrides,
  };
}

function fakeFetch(replies) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    const r = replies.shift();
    if (r.status) return { ok: false, status: r.status, json: async () => ({ error: { message: r.message || '' } }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: r.text }] }, finishReason: r.finishReason || 'STOP' }] }) };
  };
  return { fetchImpl, calls };
}

test('validateRequest accepts a real PNG and defaults language to Python', () => {
  const r = coach.validateRequest({ imageDataUrl: pngDataUrl });
  assert.equal(r.ok, true);
  assert.equal(r.value.mimeType, 'image/png');
  assert.equal(r.value.language, 'Python');
});

test('validateRequest rejects missing, non-image and oversized input', () => {
  assert.equal(coach.validateRequest({}).ok, false);
  const txt = `data:image/png;base64,${Buffer.from('hello world, not an image').toString('base64')}`;
  assert.match(coach.validateRequest({ imageDataUrl: txt }).error, /PNG, JPG and WebP/);
  const big = Buffer.alloc(coach.MAX_IMAGE_BYTES + 10);
  Buffer.from(PNG_1PX, 'base64').copy(big);
  assert.match(coach.validateRequest({ imageDataUrl: `data:image/png;base64,${big.toString('base64')}` }).error, /too large/);
  assert.equal(coach.validateRequest({ imageDataUrl: pngDataUrl, language: 'Py<script>' }).ok, false);
});

test('detectImageMime recognises jpeg and webp magic bytes', () => {
  assert.equal(coach.detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(coach.detectImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary')), 'image/webp');
});

test('validateOutput accepts a complete answer and strips speaker labels', () => {
  const raw = validOutput();
  raw.sections[0].blocks[0].text = 'Candidate: Okay, let me read this.';
  raw.sections[1].blocks[0].text = 'Step 2: we check the constraints.';
  const v = coach.validateOutput(raw);
  assert.equal(v.ok, true, v.errors.join('\n'));
  assert.equal(v.value.sections.length, 10);
  assert.equal(v.value.sections[0].blocks[0].text, 'Okay, let me read this.');
  assert.equal(v.value.sections[1].blocks[0].text, 'we check the constraints.');
});

test('validateOutput rejects wrong order, missing code and bad blocks', () => {
  const swapped = validOutput();
  [swapped.sections[0], swapped.sections[1]] = [swapped.sections[1], swapped.sections[0]];
  assert.equal(coach.validateOutput(swapped).ok, false);

  const noCode = validOutput();
  noCode.sections[5].blocks = [{ type: 'say', text: 'hi' }];
  assert.match(coach.validateOutput(noCode).errors.join(' '), /code section/);

  const badBlock = validOutput();
  badBlock.sections[2].blocks.push({ type: 'term', text: 'no term name' });
  assert.match(coach.validateOutput(badBlock).errors.join(' '), /missing "term"/);

  const nine = validOutput();
  nine.sections.pop();
  assert.equal(coach.validateOutput(nine).ok, false);
});

test('validateOutput passes through a model-reported error', () => {
  const v = coach.validateOutput({ error: 'This image is not a coding problem.', sections: [] });
  assert.equal(v.ok, true);
  assert.equal(v.value.error, 'This image is not a coding problem.');
  assert.deepEqual(v.value.sections, []);
});

test('generate sends schema, temperature and image; returns validated data', async () => {
  const { fetchImpl, calls } = fakeFetch([{ text: JSON.stringify(validOutput()) }]);
  const request = coach.validateRequest({ imageDataUrl: pngDataUrl, language: 'Java' }).value;
  const r = await coach.generate({ fetchImpl, apiKey: 'k', model: 'gemini-x', request });
  assert.equal(r.success, true);
  assert.equal(calls.length, 1);
  const body = calls[0].body;
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.temperature, 0.4);
  assert.ok(body.generationConfig.responseSchema);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'image/png');
  assert.match(body.contents[0].parts[1].text, /Java/);
  assert.match(body.systemInstruction.parts[0].text, /live coding interview/);
  assert.doesNotMatch(body.systemInstruction.parts[0].text, /<!--/);
  assert.equal(calls[0].headers['x-goog-api-key'], 'k');
  assert.doesNotMatch(calls[0].url, /key=/);
});

test('generate retries once with a repair instruction, then succeeds', async () => {
  const { fetchImpl, calls } = fakeFetch([{ text: '{"broken": ' }, { text: '```json\n' + JSON.stringify(validOutput()) + '\n```' }]);
  const request = coach.validateRequest({ imageDataUrl: pngDataUrl }).value;
  const r = await coach.generate({ fetchImpl, apiKey: 'k', model: 'm', request });
  assert.equal(r.success, true);
  assert.equal(r.attempts, 2);
  const second = calls[1].body.contents;
  assert.equal(second[1].role, 'model');
  assert.match(second[2].parts[0].text, /did not match the required format/);
});

test('generate gives a clear error after two invalid replies', async () => {
  const { fetchImpl } = fakeFetch([{ text: 'nope' }, { text: '{}' }]);
  const request = coach.validateRequest({ imageDataUrl: pngDataUrl }).value;
  const r = await coach.generate({ fetchImpl, apiKey: 'k', model: 'm', request });
  assert.equal(r.success, false);
  assert.equal(r.kind, 'invalid');
  assert.ok(r.details.length > 0);
});

test('generate falls back to schema-in-prompt when the model rejects responseSchema', async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 400, message: 'Invalid JSON payload: response_schema not supported' }, { text: JSON.stringify(validOutput()) }]);
  const request = coach.validateRequest({ imageDataUrl: pngDataUrl }).value;
  const r = await coach.generate({ fetchImpl, apiKey: 'k', model: 'm', request });
  assert.equal(r.success, true);
  assert.equal(calls[1].body.generationConfig.responseSchema, undefined);
  assert.match(calls[1].body.contents[0].parts[2].text, /JSON schema/);
});

test('generate surfaces API errors', async () => {
  const { fetchImpl } = fakeFetch([{ status: 429 }]);
  const request = coach.validateRequest({ imageDataUrl: pngDataUrl }).value;
  await assert.rejects(coach.generate({ fetchImpl, apiKey: 'k', model: 'm', request }), /Quota exceeded/);
});
