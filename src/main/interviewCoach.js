// Interview Coach: turns a screenshot of a DSA problem into a structured
// "candidate script" via Gemini structured output. Kept free of Electron
// imports so it can be unit-tested with plain `node --test`; main.js injects
// net.fetch and the API key.
const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'interview_coach.md');
const DEFAULT_MODEL = 'gemini-3.6-flash';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_NOTE_CHARS = 1000;

const SECTION_IDS = [
  'understand', 'constraints', 'example_by_hand', 'brute_force', 'optimize',
  'code', 'dry_run', 'edge_cases', 'summary', 'follow_ups',
];
const DEFAULT_TITLES = {
  understand: 'Understanding the question',
  constraints: 'Constraints',
  example_by_hand: 'Solving the example by hand',
  brute_force: 'Brute force',
  optimize: 'Optimizing',
  code: 'Coding it',
  dry_run: 'Dry run',
  edge_cases: 'Edge cases',
  summary: 'Summary',
  follow_ups: 'Follow-up questions',
};
const BLOCK_TYPES = ['say', 'pause', 'board', 'interviewer_question', 'term', 'complexity', 'code'];
// Fields each block type must carry (non-empty strings, except `which` which is an enum).
const BLOCK_FIELDS = {
  say: ['text'],
  pause: ['note'],
  board: ['text'],
  interviewer_question: ['text'],
  term: ['term', 'text'],
  complexity: ['which', 'time', 'space', 'why'],
  code: ['language', 'code'],
};

// Gemini's responseSchema is an OpenAPI subset without discriminated unions, so
// blocks are one flat object; per-type field rules are enforced by validateOutput.
const str = { type: 'STRING' };
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    error: { type: 'STRING', nullable: true },
    problem_title: str,
    difficulty: { type: 'STRING', enum: ['Easy', 'Medium', 'Hard'], nullable: true },
    language: str,
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', enum: SECTION_IDS },
          title: str,
          blocks: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: BLOCK_TYPES },
                text: str, note: str, term: str,
                which: { type: 'STRING', enum: ['brute_force', 'optimized'] },
                time: str, space: str, why: str,
                language: str, code: str,
              },
              required: ['type'],
              propertyOrdering: ['type', 'term', 'which', 'time', 'space', 'text', 'note', 'why', 'language', 'code'],
            },
          },
        },
        required: ['id', 'title', 'blocks'],
        propertyOrdering: ['id', 'title', 'blocks'],
      },
    },
    comparison: {
      type: 'OBJECT',
      properties: {
        brute_force: { type: 'OBJECT', properties: { time: str, space: str }, required: ['time', 'space'] },
        optimized: { type: 'OBJECT', properties: { time: str, space: str }, required: ['time', 'space'] },
        improvement: str,
      },
      required: ['brute_force', 'optimized', 'improvement'],
      propertyOrdering: ['brute_force', 'optimized', 'improvement'],
    },
  },
  required: ['error', 'problem_title', 'difficulty', 'language', 'sections', 'comparison'],
  propertyOrdering: ['error', 'problem_title', 'difficulty', 'language', 'sections', 'comparison'],
};

function loadSystemPrompt(promptPath = PROMPT_PATH) {
  return fs.readFileSync(promptPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
}

// ── INPUT VALIDATION ──

function detectImageMime(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Validates the renderer's request. The image's real type comes from its magic
// bytes, not the data-URL label, so a renamed file can't slip through.
function validateRequest({ imageDataUrl, language, note } = {}) {
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(imageDataUrl || '');
  if (!m) return { ok: false, error: 'Attach a screenshot of the problem first (PNG, JPG or WebP).' };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return { ok: false, error: 'The image is empty.' };
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, error: `The image is too large (${(buf.length / 1048576).toFixed(1)} MB). Max is 8 MB.` };
  const mimeType = detectImageMime(buf);
  if (!mimeType || !ALLOWED_MIME.includes(mimeType)) return { ok: false, error: 'Only PNG, JPG and WebP images are supported.' };

  const lang = typeof language === 'string' && language.trim() ? language.trim() : 'Python';
  if (lang.length > 30 || !/^[A-Za-z0-9+#. ]+$/.test(lang)) return { ok: false, error: 'Unsupported language name.' };
  const extra = typeof note === 'string' ? note.trim() : '';
  if (extra.length > MAX_NOTE_CHARS) return { ok: false, error: `The note is too long (max ${MAX_NOTE_CHARS} characters).` };

  return { ok: true, value: { mimeType, base64: buf.toString('base64'), language: lang, note: extra } };
}

// ── OUTPUT VALIDATION ──

// "Candidate:", "Interviewer:", "Me:", "Step 3:" prefixes are stripped rather than
// rejected — the block type already says who is speaking.
const LABEL_RE = /^\s*(?:\*\*)?(?:(?:candidate|interviewer|me)(?:\*\*)?\s*:|step\s*\d+(?:\*\*)?\s*[:.)\-–—])\s*/i;
function stripLabel(text) {
  let out = text;
  while (LABEL_RE.test(out)) out = out.replace(LABEL_RE, '');
  return out;
}

function parseJsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function normalizeDifficulty(d) {
  if (d === null || d === undefined || d === '') return null;
  const s = String(d).trim().toLowerCase();
  return { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[s] || null;
}

// Returns { ok, value, errors }. `value` is a cleaned copy containing only
// known fields, safe for the renderer to trust.
function validateOutput(raw, requestedLanguage = 'Python') {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['Top level must be a JSON object.'] };

  const language = isStr(raw.language) ? raw.language.trim() : requestedLanguage;

  if (isStr(raw.error)) {
    return {
      ok: true,
      errors: [],
      value: { error: raw.error.trim(), problem_title: isStr(raw.problem_title) ? raw.problem_title.trim() : '', difficulty: null, language, sections: [], comparison: null },
    };
  }

  if (!isStr(raw.problem_title)) errors.push('problem_title is missing.');
  const sectionsIn = Array.isArray(raw.sections) ? raw.sections : [];
  if (sectionsIn.length !== SECTION_IDS.length) errors.push(`sections must have exactly ${SECTION_IDS.length} items (got ${sectionsIn.length}).`);

  const sections = [];
  SECTION_IDS.forEach((id, i) => {
    const s = sectionsIn[i];
    if (!s || typeof s !== 'object') return;
    if (s.id !== id) errors.push(`sections[${i}].id must be "${id}" (got "${s.id}").`);
    const blocksIn = Array.isArray(s.blocks) ? s.blocks : [];
    if (!blocksIn.length) errors.push(`sections[${i}] (${id}) has no blocks.`);
    const blocks = [];
    blocksIn.forEach((b, j) => {
      const where = `sections[${i}].blocks[${j}]`;
      if (!b || !BLOCK_TYPES.includes(b.type)) { errors.push(`${where}.type is invalid ("${b && b.type}").`); return; }
      const out = { type: b.type };
      for (const f of BLOCK_FIELDS[b.type]) {
        if (!isStr(b[f])) { errors.push(`${where} (${b.type}) is missing "${f}".`); continue; }
        out[f] = f === 'code' ? b[f].replace(/\s+$/, '') : b[f].trim();
      }
      if (b.type === 'complexity' && out.which && !['brute_force', 'optimized'].includes(out.which)) errors.push(`${where}.which must be brute_force or optimized.`);
      if (out.text && b.type !== 'board') out.text = stripLabel(out.text);
      blocks.push(out);
    });
    sections.push({ id, title: isStr(s.title) ? stripLabel(s.title.trim()) : DEFAULT_TITLES[id], blocks });
  });

  const byId = Object.fromEntries(sections.map(s => [s.id, s]));
  const has = (id, pred) => byId[id] && byId[id].blocks.some(pred);
  if (byId.code && !has('code', b => b.type === 'code')) errors.push('The code section needs a code block with the final code.');
  if (byId.brute_force && !has('brute_force', b => b.type === 'complexity' && b.which === 'brute_force')) errors.push('The brute_force section needs a complexity block (which = brute_force).');
  if (byId.optimize && !has('optimize', b => b.type === 'complexity' && b.which === 'optimized')) errors.push('The optimize section needs a complexity block (which = optimized).');

  const c = raw.comparison || {};
  const pair = (p, name) => {
    if (!p || !isStr(p.time) || !isStr(p.space)) { errors.push(`comparison.${name} needs time and space.`); return { time: '', space: '' }; }
    return { time: p.time.trim(), space: p.space.trim() };
  };
  const comparison = { brute_force: pair(c.brute_force, 'brute_force'), optimized: pair(c.optimized, 'optimized'), improvement: isStr(c.improvement) ? c.improvement.trim() : '' };
  if (!comparison.improvement) errors.push('comparison.improvement is missing.');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: { error: null, problem_title: raw.problem_title.trim(), difficulty: normalizeDifficulty(raw.difficulty), language, sections, comparison },
  };
}

// ── GEMINI CALL ──

function geminiError(status, msg) {
  if (status === 400) return `Bad request: ${msg || 'check model name or key'}`;
  if (status === 403) return 'API key invalid or Gemini API not enabled in your Google project.';
  if (status === 404) return `Model not found: ${msg}`;
  if (status === 429) return 'Quota exceeded. Check aistudio.google.com for limits, or wait and retry.';
  return `HTTP ${status}: ${msg}`;
}

async function callGemini({ fetchImpl, apiKey, model, systemPrompt, contents, useSchema, signal }) {
  const generationConfig = { temperature: 0.4, maxOutputTokens: 32768, responseMimeType: 'application/json' };
  if (useSchema) generationConfig.responseSchema = RESPONSE_SCHEMA;
  const body = { systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig };
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal }
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(geminiError(res.status, e.error?.message || ''));
    err.status = res.status;
    err.rawMessage = e.error?.message || '';
    throw err;
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  return { text, finishReason: cand?.finishReason || null, blockReason: data.promptFeedback?.blockReason || null };
}

// Runs the request with one repair retry: if the reply isn't valid JSON or fails
// validation, the model gets the errors back once and is asked to fix them.
async function generate({ fetchImpl, apiKey, model, request, signal, promptPath }) {
  const systemPrompt = loadSystemPrompt(promptPath);
  const { mimeType, base64, language, note } = request;
  let userText = `Language for the final code: ${language}.`;
  if (note) userText += `\nExtra note from me: ${note}`;
  userText += '\nSolve the problem in this screenshot following your instructions. Return only the JSON.';
  const userTurn = { role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text: userText }] };

  let useSchema = true;
  let contents = [userTurn];
  let lastErrors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reply;
    try {
      reply = await callGemini({ fetchImpl, apiKey, model, systemPrompt, contents, useSchema, signal });
    } catch (e) {
      // Some models reject responseSchema; fall back to schema-in-prompt + validation.
      if (useSchema && e.status === 400 && /schema/i.test(e.rawMessage || '')) {
        useSchema = false;
        contents = [{ ...userTurn, parts: [...userTurn.parts, { text: `JSON schema to follow exactly:\n${JSON.stringify(RESPONSE_SCHEMA)}` }] }];
        attempt--;
        continue;
      }
      throw e;
    }
    if (reply.blockReason) throw new Error(`Gemini blocked the request (${reply.blockReason}).`);

    let parsed = null;
    let repairText;
    if (reply.finishReason === 'MAX_TOKENS') {
      lastErrors = ['The reply was cut off because it was too long.'];
      repairText = 'Your previous reply was cut off because it was too long. Answer again, same structure, but keep every block shorter. Return only the JSON.';
    } else {
      try { parsed = parseJsonText(reply.text); } catch (e) { lastErrors = [`Invalid JSON: ${e.message}`]; }
      if (parsed) {
        const v = validateOutput(parsed, language);
        if (v.ok) return { success: true, data: v.value, attempts: attempt };
        lastErrors = v.errors;
      }
      repairText = `Your previous reply did not match the required format:\n- ${lastErrors.slice(0, 15).join('\n- ')}\nReturn the corrected, complete JSON only. Keep all content that was already fine.`;
    }
    if (attempt === 2) break;
    contents = reply.finishReason === 'MAX_TOKENS' || !reply.text
      ? [{ ...userTurn, parts: [...userTurn.parts, { text: repairText }] }]
      : [...contents, { role: 'model', parts: [{ text: reply.text }] }, { role: 'user', parts: [{ text: repairText }] }];
  }
  return { success: false, kind: 'invalid', error: `The model's answer wasn't in the expected format after a retry. Try Regenerate.`, details: lastErrors.slice(0, 10) };
}

module.exports = {
  DEFAULT_MODEL,
  MAX_IMAGE_BYTES,
  SECTION_IDS,
  DEFAULT_TITLES,
  RESPONSE_SCHEMA,
  loadSystemPrompt,
  detectImageMime,
  validateRequest,
  validateOutput,
  parseJsonText,
  stripLabel,
  generate,
};
