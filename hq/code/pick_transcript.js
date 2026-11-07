// n8n Code node "Pick transcript" (Run Once for Each Item)
// Takes ElevenLabs Scribe's transcript, or falls back to the SOS's own text if there was no audio
// or transcription failed. Builds the Claude request for the next node.

// By position, not item pairing: the transcribe loop keeps order but pairing through loops is fragile.
const sos = $('One item per SOS').all()[$itemIndex].json;
const cfg = $('Check cache').first().json.cfg;
const stt = $json || {};

const sttText = typeof stt.text === 'string' ? stt.text.trim() : '';
const transcript = sttText || (sos.text || '').trim();
const lang = stt.language_code || sos.lang || 'en';
const ok = transcript.length > 0;
const sttError = stt.error ? String(stt.error.message || stt.error) : null;

const system = [
  'You triage voice SOS messages for a flood-relief operation whose radios and phones are down.',
  "Each message was recorded on an aid van's device when the van delivered rations to a household,",
  'and carried back to HQ. The transcript may be in any language. Return:',
  '- english: a faithful English translation.',
  '- needs: short list of concrete needs, e.g. "insulin", "baby formula", "drinking water". Empty if none.',
  '- urgency: 3 if life-threatening or medical (medication, injury, infant, pregnant, elderly person alone),',
  '  2 if important but not life-threatening, 1 otherwise.',
  '- people: number of people mentioned, or 0 if unknown.',
  '- reply: a short spoken reply to the household in the language of the transcript, at most two sentences,',
  '  warm and plain. Confirm what HQ understood and that it will go out with the next van.',
  '  Never promise a specific time, van or item.',
  '- reply_lang: ISO 639-1 code of the reply language.',
].join('\n');

const schema = {
  type: 'object',
  properties: {
    english: { type: 'string' },
    needs: { type: 'array', items: { type: 'string' } },
    urgency: { type: 'integer' },
    people: { type: 'integer' },
    reply: { type: 'string' },
    reply_lang: { type: 'string' },
  },
  required: ['english', 'needs', 'urgency', 'people', 'reply', 'reply_lang'],
  additionalProperties: false,
};

const claudeRequest = {
  model: cfg.claudeModel,
  max_tokens: 4000,
  fallbacks: 'default',
  output_config: { effort: cfg.claudeEffort, format: { type: 'json_schema', schema } },
  system,
  messages: [{
    role: 'user',
    content: `Household: ${sos.household}\nLanguage detected by speech recognition: ${lang}\nTranscript:\n"""\n${transcript}\n"""`,
  }],
};

return { json: { sos, transcript, lang, ok, sttError, claudeRequest } };
