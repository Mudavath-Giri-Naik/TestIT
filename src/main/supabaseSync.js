const { createClient } = require('@supabase/supabase-js');

// Publishable/anon key — safe to ship in the client, access is gated by the
// Row Level Security policies in supabase/schema.sql, not by keeping this secret.
const SUPABASE_URL = 'https://djurxhhkvgyvxywwmthp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_z_h99gbkViDyBWl-hebX4A_92uQ_ikp';

// Supabase Auth needs an email, not a bare username — this app has one
// personal user, signed in transparently with no login UI.
const AUTH_EMAIL = 'giri@ghostai.app';
const AUTH_PASSWORD = 'Giri1234';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: true },
});

let signedIn = false;

// Every sync call in this module must be fail-soft: a network hiccup or a
// misconfigured Supabase project should never break local chat, which is
// the source of truth. Callers don't need try/catch of their own.
async function withFallback(fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    console.warn('[supabase]', e.message);
    return fallback;
  }
}

async function signIn() {
  return withFallback(async () => {
    let { error } = await supabase.auth.signInWithPassword({ email: AUTH_EMAIL, password: AUTH_PASSWORD });
    if (error) {
      const { error: signUpError } = await supabase.auth.signUp({ email: AUTH_EMAIL, password: AUTH_PASSWORD });
      if (signUpError) throw signUpError;
      const retry = await supabase.auth.signInWithPassword({ email: AUTH_EMAIL, password: AUTH_PASSWORD });
      if (retry.error) throw retry.error;
    }
    signedIn = true;
    console.log('[supabase] signed in');
    return true;
  }, false);
}

function isSignedIn() {
  return signedIn;
}

async function pushSession(session) {
  if (!signedIn) return;
  await withFallback(() => supabase.from('sessions').upsert({
    id: session.id, title: session.title, provider: session.provider,
    model: session.model, tokens_used: session.tokens_used || 0, created_at: session.created_at,
  }));
}

async function pushSessionTokens(sessionId, tokens) {
  if (!signedIn) return;
  await withFallback(() => supabase.from('sessions').update({ tokens_used: tokens }).eq('id', sessionId));
}

async function pushMessage(sessionId, role, content, createdAt) {
  if (!signedIn) return;
  await withFallback(() => supabase.from('messages').insert({ session_id: sessionId, role, content, created_at: createdAt }));
}

async function pushDeleteSession(id) {
  if (!signedIn) return;
  await withFallback(() => supabase.from('sessions').delete().eq('id', id));
}

async function pushMemory(text) {
  if (!signedIn) return;
  await withFallback(() => supabase.from('memory').upsert({ id: 1, core_memory: text }));
}

async function pushApiKey(row) {
  if (!signedIn) return;
  await withFallback(() => supabase.from('api_keys').upsert({
    id: row.id, provider: row.provider, label: row.label, key_value: row.key_value,
    is_active: !!row.is_active, created_at: row.created_at,
  }));
}

async function pushDeleteApiKey(id) {
  if (!signedIn) return;
  await withFallback(() => supabase.from('api_keys').delete().eq('id', id));
}

async function pushLastSession(sessionId) {
  if (!signedIn) return;
  await withFallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return;
    await supabase.from('app_state').upsert({ user_id: uid, last_session_id: sessionId });
  });
}

// Pulls everything from Supabase for a first-run / cross-device merge.
// Returns null (never throws) if unreachable or not signed in.
async function pullAll() {
  if (!signedIn) return null;
  return withFallback(async () => {
    const [sessions, messages, memory, apiKeys, appState] = await Promise.all([
      supabase.from('sessions').select('*'),
      supabase.from('messages').select('*'),
      supabase.from('memory').select('*').eq('id', 1).maybeSingle(),
      supabase.from('api_keys').select('*'),
      supabase.from('app_state').select('*').maybeSingle(),
    ]);
    return {
      sessions: sessions.data || [],
      messages: messages.data || [],
      memory: memory.data || null,
      apiKeys: apiKeys.data || [],
      lastSessionId: appState.data?.last_session_id || null,
    };
  }, null);
}

module.exports = {
  signIn,
  isSignedIn,
  pushSession,
  pushSessionTokens,
  pushMessage,
  pushDeleteSession,
  pushMemory,
  pushApiKey,
  pushDeleteApiKey,
  pushLastSession,
  pullAll,
};
