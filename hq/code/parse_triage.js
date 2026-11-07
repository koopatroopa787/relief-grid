// n8n Code node "Parse triage" (Run Once for Each Item)
// Reads Claude's JSON answer. If Claude failed or declined, falls back to a fixed reply in the
// household's language so the household still hears something (marked degraded).

const prev = $('Pick transcript').item.json;
const cfg = $('Check cache').first().json.cfg;
const res = $json || {};

const FALLBACK_REPLY = {
  en: 'Your message reached HQ. Help will come with the next van.',
  ar: 'وصلت رسالتك إلى المقر. ستصل المساعدة مع الشاحنة التالية.',
  ur: 'آپ کا پیغام ہیڈکوارٹر تک پہنچ گیا ہے۔ اگلی وین کے ساتھ مدد پہنچے گی۔',
};

let triage = null;
let claudeError = null;
if (prev.ok) {
  try {
    if (res.error) throw new Error(String(res.error.message || JSON.stringify(res.error)));
    if (res.stop_reason === 'refusal') throw new Error('Claude declined the request');
    const textBlock = (res.content || []).find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text block in Claude response');
    triage = JSON.parse(textBlock.text);
  } catch (err) {
    claudeError = String(err.message || err);
  }
}

const lang2 = String(prev.lang || 'en').slice(0, 2).toLowerCase();
const degraded = !triage;
if (!triage) {
  triage = {
    english: prev.transcript,
    needs: [],
    urgency: 2,
    people: 0,
    reply: FALLBACK_REPLY[lang2] || FALLBACK_REPLY.en,
    reply_lang: FALLBACK_REPLY[lang2] ? lang2 : 'en',
  };
}

return {
  json: {
    sos: prev.sos,
    ok: prev.ok,
    transcript: prev.transcript,
    lang: prev.lang,
    triage,
    degraded,
    errors: { stt: prev.sttError, claude: claudeError },
    ttsRequest: { text: triage.reply, model_id: cfg.ttsModel },
  },
};
