// n8n Code node "Check cache" (Run Once for All Items)
// First step after the webhook. Holds the config, splits the batch into SOS notes HQ has
// already answered (cached) and new ones (fresh). This is the cross-run de-duplication (FIXES F7):
// the same SOS can arrive in two vans' batches, or be resent after a timeout, and is handled once.
// The cache lives in n8n's workflow static data, which persists between PRODUCTION executions
// (workflow active, called on /webhook/sos), not between manual test runs.

// ---- Config: edit these ----
const CONFIG = {
  simBase: 'http://localhost:8000/',          // where the sim serves SOS audio (relative `audio` paths resolve here)
  elevenBase: 'https://api.elevenlabs.io',
  anthropicBase: 'https://api.anthropic.com',
  claudeModel: 'claude-opus-5-5',
  claudeEffort: 'low',                         // fast triage; raise to 'medium' if replies look weak
  voiceId: 'JBFqnCBsd6RMkjVDRZzb',             // any ElevenLabs voice id; pick one that sounds good in Arabic/Urdu
  ttsModel: 'eleven_multilingual_v2',
  slackWebhookUrl: '',                         // optional Slack incoming-webhook URL for urgent SOS alerts
};
// ----------------------------

const body = $input.first().json.body || {};
const batch = Array.isArray(body.batch) ? body.batch : [];

const store = $getWorkflowStaticData('global');
store.replies = store.replies || {};

const fresh = [];
const cached = [];
const seen = new Set();
for (const sos of batch) {
  if (!sos || !sos.sos_id || seen.has(sos.sos_id)) continue;
  seen.add(sos.sos_id);
  if (store.replies[sos.sos_id]) cached.push(store.replies[sos.sos_id]);
  else fresh.push(sos);
}

return [{ json: { cfg: CONFIG, van: body.van ?? null, t: body.t ?? null, fresh, cached } }];
