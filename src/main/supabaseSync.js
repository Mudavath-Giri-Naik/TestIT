const { createClient } = require('@supabase/supabase-js');

// Publishable/anon key — safe to ship in the client. There is no login step:
// every install of the app reads/writes the same shared tables directly
// through this anon key, gated only by the open RLS policies in
// supabase/schema.sql (not by any per-user auth check).
const SUPABASE_URL = 'https://djurxhhkvgyvxywwmthp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_z_h99gbkViDyBWl-hebX4A_92uQ_ikp';

// app_state's primary key is a uuid column; with no auth session there's no
// auth.uid() to key it to, so every install shares this one fixed row.
const GLOBAL_ROW_ID = '00000000-0000-0000-0000-000000000001';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Every sync call in this module must be fail-soft: a network hiccup or a
// misconfigured Supabase project should never break local chat, which is
// the source of truth. Callers don't need try/catch of their own.
//
// Supabase-js query results resolve to `{ data, error }` — they do NOT
// reject/throw on a query-level failure (RLS block, missing table, bad
// column, etc). Without checking `.error` here, a misconfigured project
// would silently look like "no rows" instead of surfacing the real reason,
// which is exactly what made cross-device key sync fail silently before.
async function withFallback(fn, fallback) {
  try {
    const result = await fn();
    if (result && result.error) throw new Error(result.error.message || 'Supabase request failed');
    return result;
  } catch (e) {
    console.warn('[supabase]', e.message);
    return fallback;
  }
}

async function pushSession(session) {
  await withFallback(() => supabase.from('sessions').upsert({
    id: session.id, title: session.title, provider: session.provider,
    model: session.model, tokens_used: session.tokens_used || 0, created_at: session.created_at,
  }));
}

async function pushSessionTokens(sessionId, tokens) {
  await withFallback(() => supabase.from('sessions').update({ tokens_used: tokens }).eq('id', sessionId));
}

async function pushMessage(sessionId, role, content, createdAt) {
  await withFallback(() => supabase.from('messages').insert({ session_id: sessionId, role, content, created_at: createdAt }));
}

async function pushDeleteSession(id) {
  await withFallback(() => supabase.from('sessions').delete().eq('id', id));
}

async function pushMemory(text) {
  await withFallback(() => supabase.from('memory').upsert({ id: 1, core_memory: text }));
}

async function pushApiKey(row) {
  await withFallback(() => supabase.from('api_keys').upsert({
    id: row.id, provider: row.provider, label: row.label, key_value: row.key_value,
    is_active: !!row.is_active, created_at: row.created_at,
    rl_limit_tokens: row.rl_limit_tokens ?? null,
    rl_remaining_tokens: row.rl_remaining_tokens ?? null,
    rl_updated_at: row.rl_updated_at ?? null,
  }));
}

async function pushDeleteApiKey(id) {
  await withFallback(() => supabase.from('api_keys').delete().eq('id', id));
}

async function pushLastSession(sessionId) {
  await withFallback(() => supabase.from('app_state').upsert({ user_id: GLOBAL_ROW_ID, last_session_id: sessionId }));
}

// Raw pull of everything from Supabase — throws on any query failure
// (RLS block, missing table, bad column, network error) instead of
// hiding it, so callers that want to know *why* a sync failed can.
async function fetchAllRemote() {
  const [sessions, messages, memory, apiKeys, appState] = await Promise.all([
    supabase.from('sessions').select('*'),
    supabase.from('messages').select('*'),
    supabase.from('memory').select('*').eq('id', 1).maybeSingle(),
    supabase.from('api_keys').select('*'),
    supabase.from('app_state').select('*').eq('user_id', GLOBAL_ROW_ID).maybeSingle(),
  ]);
  // Each query resolves with its own { data, error } — a failure on any one
  // of them (e.g. RLS blocking api_keys) must not be silently read as "empty".
  const failed = [sessions, messages, memory, apiKeys, appState].find(r => r.error);
  if (failed) throw new Error(failed.error.message || 'Supabase pull failed');
  return {
    sessions: sessions.data || [],
    messages: messages.data || [],
    memory: memory.data || null,
    apiKeys: apiKeys.data || [],
    lastSessionId: appState.data?.last_session_id || null,
  };
}

// Fail-soft variant for the silent background sync on app launch.
// Returns null (never throws) if unreachable/misconfigured.
async function pullAll() {
  return withFallback(fetchAllRemote, null);
}

// Throwing variant for a user-initiated "Refresh" — the caller wants to
// know the real reason a sync came back empty, not just get null.
async function pullAllOrThrow() {
  return fetchAllRemote();
}

module.exports = {
  pushSession,
  pushSessionTokens,
  pushMessage,
  pushDeleteSession,
  pushMemory,
  pushApiKey,
  pushDeleteApiKey,
  pushLastSession,
  pullAll,
  pullAllOrThrow,
};
