// n8n Code node "One item per SOS" (Run Once for All Items)
// Turns the fresh SOS list into one n8n item each, with an absolute audio URL to download.

const { cfg, fresh } = $input.first().json;

function toUrl(audio, base) {
  if (!audio) return '';
  if (/^https?:\/\//.test(audio)) return audio;
  return base.replace(/\/+$/, '') + '/' + String(audio).replace(/^\/+/, '');
}

return fresh.map(sos => ({
  json: {
    sos_id: sos.sos_id,
    household: sos.household,
    lang: sos.lang || null,
    text: sos.text || null,
    audio_url: toUrl(sos.audio, cfg.simBase),
  },
}));
