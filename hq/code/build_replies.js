// n8n Code node "Build replies" (Run Once for All Items)
// Joins each triaged SOS with its spoken reply (base64 MP3), caches successful replies so a resent
// SOS is answered without reprocessing, and builds the webhook response.
// If any SOS could not be transcribed, answers 503 so the sim's hq_link keeps the batch and retries;
// the ones that worked are cached, so the retry only redoes the failures.

const head = $('Check cache').first().json;
const triaged = $('Parse triage').all();
const tts = $input.all();

const store = $getWorkflowStaticData('global');
store.replies = store.replies || {};

const replies = [...head.cached];
const failed = [];
const urgent = [];

for (let i = 0; i < triaged.length; i++) {
  const p = triaged[i].json;
  if (!p.ok) {
    failed.push({ sos_id: p.sos.sos_id, why: p.errors.stt || 'no audio and no text' });
    continue;
  }
  let audio_b64 = null;
  let tts_error = null;
  const item = tts[i];
  if (item && item.binary && item.binary.data) {
    try {
      audio_b64 = (await this.helpers.getBinaryDataBuffer(i, 'data')).toString('base64');
    } catch (err) {
      tts_error = String(err.message || err); // reply still goes out as text
    }
  } else if (item && item.json && item.json.error) {
    const e = item.json.error;
    tts_error = String(e.message || e.description || JSON.stringify(e)).slice(0, 300);
  }
  const reply = {
    sos_id: p.sos.sos_id,
    household: p.sos.household,
    lang: p.triage.reply_lang || p.lang,
    text: p.triage.reply,
    audio_b64,
    mime: 'audio/mpeg',
    english: p.triage.english,
    needs: p.triage.needs,
    urgency: p.triage.urgency,
    degraded: p.degraded,
    tts_error, // why there is no audio, if there isn't (shown for debugging)
  };
  // Only cache complete answers. A degraded (fallback) or audio-less reply is still sent now,
  // but the SOS gets reprocessed next time, e.g. once an API key is fixed.
  if (!reply.degraded && reply.audio_b64) store.replies[reply.sos_id] = reply;
  replies.push(reply);
  if (reply.urgency >= 3) urgent.push(reply);
}

const status = failed.length ? 503 : 200;
const response = failed.length
  ? { error: 'Some SOS notes could not be transcribed; resend the batch later.', failed, replies }
  : { replies };

return [{ json: { status, response, urgent, slack: head.cfg.slackWebhookUrl, van: head.van, t: head.t } }];
