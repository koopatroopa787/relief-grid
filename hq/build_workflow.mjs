// Builds hq/workflow.json (importable into n8n) from the Code-node scripts in hq/code/.
// Edit the scripts, then run:  node hq/build_workflow.mjs
// Node built-ins only.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const code = name => readFileSync(join(here, 'code', name), 'utf8');

const CRED_ELEVEN = { httpHeaderAuth: { id: 'rgElevenLabsKey1', name: 'ElevenLabs API key' } };
const CRED_CLAUDE = { httpHeaderAuth: { id: 'rgAnthropicKey01', name: 'Anthropic API key' } };
const CFG = "$('Check cache').first().json.cfg";

let x = 0;
const pos = (dx = 220, y = 300) => [(x += dx), y];

const codeNode = (name, file, mode, position) => ({
  parameters: mode === 'each' ? { mode: 'runOnceForEachItem', jsCode: code(file) } : { jsCode: code(file) },
  name, type: 'n8n-nodes-base.code', typeVersion: 2, position,
});

const http = (name, params, position, extra = {}) => ({
  parameters: { ...params },
  name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position,
  onError: 'continueRegularOutput', ...extra,
});

const fileResponse = timeout => ({ timeout, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } });

const ifNode = (name, conditions, position) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: conditions.map((c, i) => ({ id: `${name}-${i}`, ...c })),
      combinator: 'and',
    },
    options: {},
  },
  name, type: 'n8n-nodes-base.if', typeVersion: 2, position,
});

const nodes = [
  {
    parameters: {
      httpMethod: 'POST', path: 'sos', responseMode: 'responseNode',
      options: { allowedOrigins: '*' },
    },
    name: 'SOS batch in', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos(0),
    webhookId: '6f1c2a9e-5d3b-4e8a-9c71-2b4f0d9e8a11',
  },
  codeNode('Check cache', 'check_cache.js', 'all', pos()),
  ifNode('Anything new?', [
    { leftValue: '={{ $json.fresh.length }}', rightValue: 0, operator: { type: 'number', operation: 'gt' } },
  ], pos()),
  codeNode('One item per SOS', 'one_per_sos.js', 'all', pos(220, 200)),
  http('Fetch SOS audio', {
    url: '={{ $json.audio_url }}',
    options: fileResponse(15000),
  }, pos(220, 200)),
  http('ElevenLabs Scribe: transcribe', {
    method: 'POST',
    url: `={{ ${CFG}.elevenBase }}/v1/speech-to-text`,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, contentType: 'multipart-form-data',
    bodyParameters: { parameters: [
      { name: 'model_id', value: 'scribe_v1' },
      { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
    ] },
    options: { timeout: 30000 },
  }, pos(220, 200), { credentials: CRED_ELEVEN }),
  codeNode('Pick transcript', 'pick_transcript.js', 'each', pos(220, 200)),
  http('Claude: translate, triage, reply', {
    method: 'POST',
    url: `={{ ${CFG}.anthropicBase }}/v1/messages`,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'anthropic-version', value: '2026-10-21' },
      { name: 'anthropic-beta', value: 'server-side-fallback-2026-07-01' },
    ] },
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.claudeRequest) }}',
    options: { timeout: 60000 },
  }, pos(220, 200), { credentials: CRED_CLAUDE }),
  codeNode('Parse triage', 'parse_triage.js', 'each', pos(220, 200)),
  http('ElevenLabs: spoken reply', {
    method: 'POST',
    url: `={{ ${CFG}.elevenBase }}/v1/text-to-speech/{{ ${CFG}.voiceId }}?output_format=mp3_44100_64`,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.ttsRequest) }}',
    options: fileResponse(30000),
  }, pos(220, 200), { credentials: CRED_ELEVEN }),
  codeNode('Build replies', 'build_replies.js', 'all', pos(220, 200)),
];

x = 660;
nodes.push(codeNode('Cached replies only', 'cached_only.js', 'all', [880, 420]));
nodes.push({
  parameters: {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify($json.response) }}',
    options: { responseCode: '={{ $json.status }}' },
  },
  name: 'Respond to sim', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [2860, 300],
});
nodes.push(ifNode('Urgent and Slack set?', [
  { leftValue: '={{ ($json.urgent || []).length }}', rightValue: 0, operator: { type: 'number', operation: 'gt' } },
  { leftValue: "={{ $json.slack || '' }}", rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
], [3080, 300]));
nodes.push(http('Slack: urgent SOS alert', {
  method: 'POST',
  url: '={{ $json.slack }}',
  sendBody: true, specifyBody: 'json',
  jsonBody: "={{ JSON.stringify({ text: '🚨 Urgent SOS at HQ\\n' + $json.urgent.map(r => r.household + ': ' + r.english + (r.needs.length ? ' (needs: ' + r.needs.join(', ') + ')' : '')).join('\\n') }) }}",
  options: { timeout: 10000 },
}, [3300, 200]));

const link = (...names) => names.map(n => ({ node: n, type: 'main', index: 0 }));
const connections = {
  'SOS batch in': { main: [link('Check cache')] },
  'Check cache': { main: [link('Anything new?')] },
  'Anything new?': { main: [link('One item per SOS'), link('Cached replies only')] },
  'One item per SOS': { main: [link('Fetch SOS audio')] },
  'Fetch SOS audio': { main: [link('ElevenLabs Scribe: transcribe')] },
  'ElevenLabs Scribe: transcribe': { main: [link('Pick transcript')] },
  'Pick transcript': { main: [link('Claude: translate, triage, reply')] },
  'Claude: translate, triage, reply': { main: [link('Parse triage')] },
  'Parse triage': { main: [link('ElevenLabs: spoken reply')] },
  'ElevenLabs: spoken reply': { main: [link('Build replies')] },
  'Build replies': { main: [link('Respond to sim')] },
  'Cached replies only': { main: [link('Respond to sim')] },
  'Respond to sim': { main: [link('Urgent and Slack set?')] },
  'Urgent and Slack set?': { main: [link('Slack: urgent SOS alert'), []] },
};

const workflow = {
  id: 'reliefGridHQ0001',
  name: 'Relief Grid HQ',
  nodes: nodes.map((n, i) => ({ id: `rg-node-${String(i + 1).padStart(2, '0')}`, ...n })),
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
  active: false,
  staticData: null,
};

writeFileSync(join(here, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote hq/workflow.json (${nodes.length} nodes)`);
