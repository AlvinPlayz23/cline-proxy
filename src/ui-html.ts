/** Single-file dashboard served at /ui. No build step, no dependencies. */
export const UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cline-proxy</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%23111'/%3E%3Cpath d='M4 8h8M8 4v8' stroke='%23fff' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E">
<style>
:root {
  --bg: #ffffff; --panel: #fafafa; --hover: #f3f3f3; --active: #efefef;
  --border: #e6e6e6; --text: #111111; --muted: #777777; --code: #f5f5f5;
  --ok: #16a34a; --err: #dc2626; --warn: #d97706; --idle: #a3a3a3;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d0d; --panel: #131313; --hover: #1a1a1a; --active: #202020;
    --border: #262626; --text: #ededed; --muted: #8a8a8a; --code: #171717;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; display: flex; flex-direction: column; }
button { font: inherit; color: inherit; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover { background: var(--hover); }
input { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; outline: none; width: 220px; }
input:focus { border-color: var(--muted); }
header { display: flex; align-items: center; gap: 16px; padding: 0 16px; height: 48px; border-bottom: 1px solid var(--border); flex: none; }
.brand { font-weight: 600; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
.brand i { width: 8px; height: 8px; border-radius: 50%; background: var(--idle); display: inline-block; }
.brand i.on { background: var(--ok); }
nav { display: flex; gap: 2px; }
nav button { border: none; color: var(--muted); }
nav button.active { color: var(--text); background: var(--active); }
.spacer { flex: 1; }
main { flex: 1; display: flex; min-height: 0; }
#list { width: 360px; flex: none; border-right: 1px solid var(--border); overflow-y: auto; background: var(--panel); }
#pane { flex: 1; overflow-y: auto; min-width: 0; }
.item { display: flex; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); cursor: pointer; }
.item:hover { background: var(--hover); }
.item.active { background: var(--active); }
.item-main { min-width: 0; flex: 1; }
.item-top { display: flex; justify-content: space-between; gap: 8px; }
.item-model { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-time, .item-meta { color: var(--muted); font-size: 12px; white-space: nowrap; }
.item-preview { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-preview.err { color: var(--err); }
.item-meta { display: flex; gap: 8px; align-items: center; margin-top: 2px; }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--idle); }
.dot.ok { background: var(--ok); } .dot.error { background: var(--err); }
.dot.pending { background: var(--warn); animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.logo { display: inline-flex; align-items: center; justify-content: center; flex: none; background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 3px; overflow: hidden; color: #555; font-size: 11px; font-weight: 600; }
.logo img { width: 100%; height: 100%; object-fit: contain; }
.empty { color: var(--muted); padding: 48px 24px; text-align: center; }
.empty code { font-family: var(--mono); background: var(--code); padding: 2px 6px; border-radius: 4px; }
.head { padding: 16px 24px 0; }
.title { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
.chip { border: 1px solid var(--border); border-radius: 999px; padding: 1px 10px; color: var(--muted); font-size: 12px; }
.chip.ok { color: var(--ok); } .chip.error { color: var(--err); } .chip.pending { color: var(--warn); }
.tabs { display: flex; gap: 2px; padding: 12px 24px 0; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 1; }
.tabs button { border: none; border-bottom: 2px solid transparent; border-radius: 0; color: var(--muted); padding: 6px 12px; }
.tabs button.active { color: var(--text); border-bottom-color: var(--text); }
.tabs button:hover { background: none; color: var(--text); }
.body { padding: 20px 24px 48px; max-width: 980px; }
.banner { border: 1px solid var(--err); color: var(--err); border-radius: 8px; padding: 10px 14px; margin: 16px 0 0; white-space: pre-wrap; word-break: break-word; }
.msg { margin: 0 0 14px; }
.msg > summary, .box > summary { cursor: pointer; list-style: none; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; user-select: none; }
.msg > summary::-webkit-details-marker, .box > summary::-webkit-details-marker { display: none; }
.msg > summary::before, .box > summary::before { content: "\25B8"; display: inline-block; margin-right: 6px; }
.msg[open] > summary::before, .box[open] > summary::before { content: "\25BE"; display: inline-block; margin-right: 6px; }
.msg.assistant > .content { border-left: 2px solid var(--text); }
.content { display: flex; flex-direction: column; gap: 8px; padding-left: 12px; border-left: 2px solid var(--border); }
pre { margin: 0; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.text { font-size: 13px; }
.code { background: var(--code); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow-x: auto; }
.box { border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; background: var(--panel); }
.box > summary { margin: 0; text-transform: none; letter-spacing: 0; font-size: 12px; }
.box[open] > summary { margin-bottom: 8px; }
.muted { color: var(--muted); }
.toolbar { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; color: var(--muted); }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; vertical-align: top; padding: 5px 12px 5px 0; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 400; white-space: nowrap; width: 1%; }
td { font-family: var(--mono); font-size: 12px; word-break: break-all; }
.stream td:first-child, .stream td:nth-child(2) { white-space: nowrap; color: var(--muted); width: 1%; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 500; margin: 24px 0 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.card summary { display: flex; align-items: center; gap: 10px; cursor: pointer; list-style: none; }
.card summary::-webkit-details-marker { display: none; }
.card .count { margin-left: auto; color: var(--muted); }
.model-row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-top: 1px solid var(--border); cursor: pointer; }
.model-row:first-of-type { margin-top: 10px; }
.model-row:hover { color: var(--muted); }
.model-row span:last-child { color: var(--muted); font-size: 12px; white-space: nowrap; }
@media (max-width: 800px) { #list { width: 100%; max-height: 40%; border-right: none; border-bottom: 1px solid var(--border); } main { flex-direction: column; } }
</style>
</head>
<body>
<header>
  <div class="brand"><i id="conn"></i>cline-proxy</div>
  <nav>
    <button id="nav-requests" class="active">Requests</button>
    <button id="nav-models">Models</button>
  </nav>
  <div class="spacer"></div>
  <input id="filter" type="search" placeholder="Filter&hellip;" autocomplete="off">
  <button id="clear">Clear</button>
</header>
<main>
  <div id="list"></div>
  <div id="pane"></div>
</main>
<script>
(function () {
'use strict';

var state = { logs: [], selected: null, detail: null, tab: 'conversation', view: 'requests', filter: '', info: null, showAllChunks: false };
var $ = function (sel) { return document.querySelector(sel); };

function append(node, kid) {
  if (kid == null || kid === false) return;
  if (Array.isArray(kid)) { kid.forEach(function (k) { append(node, k); }); return; }
  node.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
}
function el(tag, props) {
  var node = document.createElement(tag);
  if (props) Object.keys(props).forEach(function (k) {
    var v = props[k];
    if (v == null || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  });
  for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
  return node;
}
function pad(n) { return n < 10 ? '0' + n : String(n); }
function fmtTime(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function fmtDur(ms) { return ms == null ? '\u2026' : ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's'; }
function fmtNum(n) { return n == null ? '\u2013' : n.toLocaleString(); }
function pretty(v) { try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); } }
function modelLabel(s) { return s.providerId ? s.providerId + '/' + s.modelId : (s.requestedModel || 'unknown'); }

function copyText(text, btn) {
  var done = function () { var old = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = old; }, 1200); };
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, done); return; }
  var ta = el('textarea', { style: 'position:fixed;opacity:0' });
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove(); done();
}
function copyBtn(getText, label) {
  var btn = el('button', { text: label || 'Copy' });
  btn.addEventListener('click', function () { copyText(getText(), btn); });
  return btn;
}

function logo(id, size) {
  var box = el('span', { class: 'logo', style: 'width:' + size + 'px;height:' + size + 'px' });
  if (!id) { box.textContent = '?'; return box; }
  var img = el('img', { src: '/ui/logo/' + encodeURIComponent(id), alt: '', loading: 'lazy' });
  img.addEventListener('error', function () { img.remove(); box.textContent = id.charAt(0).toUpperCase(); });
  box.appendChild(img);
  return box;
}

function longText(str) {
  var LIMIT = 20000;
  var pre = el('pre', { class: 'text', text: str.length > LIMIT ? str.slice(0, LIMIT) : str });
  if (str.length <= LIMIT) return pre;
  var wrap = el('div');
  var more = el('button', { text: 'Show all ' + str.length.toLocaleString() + ' chars' });
  more.addEventListener('click', function () { pre.textContent = str; more.remove(); });
  append(wrap, [pre, more]);
  return wrap;
}
function jsonBox(label, value, open) {
  var text = typeof value === 'string' ? value : pretty(value);
  return el('details', { class: 'box', open: open }, el('summary', { text: label }), el('pre', { class: 'code', text: text }));
}
function toolBox(kind, name, id, payload) {
  var label = (kind === 'call' ? 'tool call \u00b7 ' : 'tool result \u00b7 ') + (name || 'tool') + (id ? '  (' + id + ')' : '');
  return jsonBox(label, payload, true);
}

function contentNodes(msg) {
  var out = [];
  var c = msg.content;
  if (msg.role === 'tool') {
    out.push(toolBox('result', msg.name, msg.tool_call_id, c));
    return out;
  }
  if (typeof c === 'string') { if (c) out.push(longText(c)); }
  else if (Array.isArray(c)) c.forEach(function (p) {
    if (!p) return;
    if (p.type === 'text' || p.type === 'input_text') { if (p.text) out.push(longText(p.text)); }
    else if (p.type === 'image' || p.type === 'image_url') out.push(el('span', { class: 'chip', text: 'image' }));
    else if (p.type === 'tool_use') out.push(toolBox('call', p.name, p.id, p.input));
    else if (p.type === 'tool_result') out.push(toolBox('result', p.name, p.tool_use_id, p.content));
    else if (p.type === 'thinking') out.push(el('pre', { class: 'text muted', text: p.thinking || '' }));
    else out.push(jsonBox(p.type || 'part', p, false));
  });
  if (Array.isArray(msg.tool_calls)) msg.tool_calls.forEach(function (tc) {
    var fn = tc.function || {};
    var args = fn.arguments;
    try { args = JSON.parse(args); } catch (e) {}
    out.push(toolBox('call', fn.name, tc.id, args));
  });
  if (!out.length) out.push(el('span', { class: 'muted', text: '(empty)' }));
  return out;
}
function msgBlock(role, nodes, open) {
  return el('details', { class: 'msg ' + role, open: open },
    el('summary', { text: role }),
    el('div', { class: 'content' }, nodes));
}

function conversationView(e) {
  var root = el('div');
  var t = e.translated, req = e.request || {};
  var system, messages, tools;
  if (t) { system = t.systemPrompt; messages = t.messages; tools = t.tools; }
  else { messages = req.messages; tools = (req.tools || []).map(function (x) { return x.function || x; }); }
  if (system) root.appendChild(msgBlock('system', [longText(system)], false));
  if (tools && tools.length) {
    var list = el('div', { class: 'content' });
    tools.forEach(function (tool) {
      var schema = tool.inputSchema || tool.parameters || {};
      list.appendChild(jsonBox(tool.name + (tool.description ? ' \u2014 ' + tool.description.slice(0, 80) : ''), schema, false));
    });
    root.appendChild(el('details', { class: 'msg' }, el('summary', { text: 'tools (' + tools.length + ')' }), list));
  }
  (Array.isArray(messages) ? messages : []).forEach(function (m) {
    root.appendChild(msgBlock(m.role, contentNodes(m), true));
  });
  root.appendChild(responseBlock(e));
  return root;
}
function responseBlock(e) {
  var r = e.response || {};
  var nodes = [];
  if (r.reasoning) nodes.push(el('details', { class: 'box' }, el('summary', { text: 'reasoning (' + r.reasoning.length.toLocaleString() + ' chars)' }), el('pre', { class: 'text muted', text: r.reasoning })));
  if (r.text) nodes.push(longText(r.text));
  (r.toolCalls || []).forEach(function (tc) { nodes.push(toolBox('call', tc.name, tc.id, tc.arguments)); });
  if (!nodes.length) nodes.push(el('span', { class: 'muted', text: e.status === 'pending' ? 'Waiting for the provider\u2026' : '(no output)' }));
  return msgBlock('assistant', nodes, true);
}

function requestView(e) {
  var text = pretty(e.request);
  return el('div', null,
    el('div', { class: 'toolbar' }, copyBtn(function () { return text; }), el('span', { text: 'Body as received from the client' })),
    el('pre', { class: 'code', text: text }),
    e.translated ? el('div', null, el('h3', { text: 'Translated for Cline provider' }), el('pre', { class: 'code', text: pretty(e.translated) })) : null);
}
function sentView(e) {
  var items = e.sent || [];
  if (!items.length) return el('div', { class: 'muted', text: e.status === 'pending' ? 'Nothing sent yet.' : 'Nothing was sent.' });
  var text = items.map(function (p) { if (e.stream) return p; try { return pretty(JSON.parse(p)); } catch (x) { return p; } }).join('\n');
  return el('div', null,
    el('div', { class: 'toolbar' }, copyBtn(function () { return text; }), el('span', { text: items.length + ' payload' + (items.length === 1 ? '' : 's') + ' written to the client' })),
    el('pre', { class: 'code', text: text }));
}
function streamView(e) {
  var chunks = e.chunks || [];
  if (!chunks.length) return el('div', { class: 'muted', text: 'No provider chunks recorded.' });
  var LIMIT = 1000;
  var shown = state.showAllChunks ? chunks : chunks.slice(0, LIMIT);
  var tbody = el('tbody');
  shown.forEach(function (c) {
    var body = c.type === 'text' ? JSON.stringify(c.text) : c.type === 'reasoning' ? JSON.stringify(c.reasoning) : (function () { var o = {}; Object.keys(c).forEach(function (k) { if (k !== 't' && k !== 'type') o[k] = c[k]; }); return JSON.stringify(o); })();
    tbody.appendChild(el('tr', null, el('td', { text: '+' + c.t + 'ms' }), el('td', { text: c.type }), el('td', { text: body })));
  });
  var root = el('div', null,
    el('div', { class: 'toolbar' }, copyBtn(function () { return pretty(chunks); }, 'Copy JSON'), el('span', { text: chunks.length + ' chunks from the provider' + (e.chunksTruncated ? ' (truncated)' : '') })),
    el('table', { class: 'stream' }, tbody));
  if (chunks.length > shown.length) {
    root.appendChild(el('button', { text: 'Show all ' + chunks.length, onclick: function () { state.showAllChunks = true; renderPane(); } }));
  }
  return root;
}
function kvTable(rows) {
  var tbody = el('tbody');
  rows.forEach(function (r) { if (r[1] != null && r[1] !== '') tbody.appendChild(el('tr', null, el('th', { text: r[0] }), el('td', { text: String(r[1]) }))); });
  return el('table', null, tbody);
}
function metaView(e) {
  var r = e.response || {}, u = r.usage || {};
  var rows = [
    ['id', e.id], ['time', new Date(e.createdAt).toISOString()],
    ['duration', e.finishedAt ? fmtDur(e.finishedAt - e.createdAt) : null],
    ['endpoint', 'POST ' + e.endpoint], ['stream', String(e.stream)],
    ['requested model', e.requestedModel], ['resolved', e.providerId ? e.providerId + '/' + e.modelId : null],
    ['status', e.status], ['http status', e.httpStatus], ['finish reason', r.finishReason],
    ['input tokens', u.inputTokens], ['output tokens', u.outputTokens],
    ['cache read', u.cacheReadTokens], ['cache write', u.cacheWriteTokens], ['reasoning tokens', u.thoughtsTokenCount],
    ['cost (USD)', r.cost], ['client ip', e.client && e.client.ip]
  ];
  var headers = (e.client && e.client.headers) || {};
  return el('div', null, kvTable(rows), el('h3', { text: 'Client headers' }),
    kvTable(Object.keys(headers).map(function (k) { return [k, headers[k]]; })));
}

var TABS = [['conversation', 'Conversation'], ['request', 'Request'], ['sent', 'Sent'], ['stream', 'Stream'], ['meta', 'Meta']];
function detailView(e) {
  var r = e.response || {}, u = r.usage;
  var chips = el('div', { class: 'chips' },
    el('span', { class: 'chip ' + e.status, text: e.status + (e.httpStatus ? ' \u00b7 ' + e.httpStatus : '') }),
    el('span', { class: 'chip', text: fmtTime(e.createdAt) }),
    el('span', { class: 'chip', text: fmtDur(e.finishedAt ? e.finishedAt - e.createdAt : null) }),
    el('span', { class: 'chip', text: e.stream ? 'stream' : 'non-stream' }),
    u ? el('span', { class: 'chip', text: fmtNum(u.inputTokens) + ' in \u00b7 ' + fmtNum(u.outputTokens) + ' out' }) : null,
    r.cost != null ? el('span', { class: 'chip', text: '$' + Number(r.cost).toFixed(5) }) : null,
    r.finishReason ? el('span', { class: 'chip', text: 'finish: ' + r.finishReason }) : null);
  var head = el('div', { class: 'head' },
    el('div', { class: 'title' }, logo(e.providerId, 26), el('span', { text: e.providerId ? e.providerId + '/' + e.modelId : (e.requestedModel || 'unknown model') })),
    chips,
    r.error ? el('div', { class: 'banner', text: r.error }) : null);
  var tabs = el('div', { class: 'tabs' });
  TABS.forEach(function (t) {
    tabs.appendChild(el('button', { class: state.tab === t[0] ? 'active' : '', text: t[1], onclick: function () { state.tab = t[0]; renderPane(); } }));
  });
  var views = { conversation: conversationView, request: requestView, sent: sentView, stream: streamView, meta: metaView };
  return el('div', null, head, tabs, el('div', { class: 'body' }, views[state.tab](e)));
}

function statusDot(s) { return el('span', { class: 'dot ' + s.status, title: s.status }); }
function matches(s) {
  if (!state.filter) return true;
  var hay = (modelLabel(s) + ' ' + s.preview + ' ' + s.status + ' ' + (s.error || '')).toLowerCase();
  return hay.indexOf(state.filter) >= 0;
}
function renderList() {
  var box = $('#list');
  box.textContent = '';
  var shown = state.logs.filter(matches);
  if (!shown.length) {
    box.appendChild(el('div', { class: 'empty', text: state.logs.length ? 'No matches.' : 'No requests yet.' }));
    return;
  }
  shown.forEach(function (s) {
    var u = s.usage;
    var meta = [statusDot(s), el('span', { text: fmtDur(s.durationMs) })];
    if (u) meta.push(el('span', { text: fmtNum(u.inputTokens) + ' \u2192 ' + fmtNum(u.outputTokens) }));
    if (s.toolCalls) meta.push(el('span', { text: s.toolCalls + ' tool call' + (s.toolCalls === 1 ? '' : 's') }));
    if (s.stream) meta.push(el('span', { text: 'stream' }));
    var failed = s.status === 'error' && s.error;
    box.appendChild(el('div', { class: 'item' + (s.id === state.selected ? ' active' : ''), onclick: function () { select(s.id); } },
      logo(s.providerId, 24),
      el('div', { class: 'item-main' },
        el('div', { class: 'item-top' }, el('span', { class: 'item-model', text: modelLabel(s) }), el('span', { class: 'item-time', text: fmtTime(s.createdAt) })),
        el('div', { class: 'item-preview' + (failed ? ' err' : ''), text: failed ? s.error : (s.preview || '(no text)') }),
        el('div', { class: 'item-meta' }, meta))));
  });
}

function modelsView() {
  var info = state.info;
  var root = el('div', { class: 'body' });
  if (!info) { root.appendChild(el('div', { class: 'muted', text: 'Loading\u2026' })); return root; }
  root.appendChild(el('div', { class: 'toolbar' }, el('span', { text: 'Use as providerId/model in the model field. Settings: ' + info.settingsPath })));
  var grid = el('div', { class: 'grid' });
  info.providers.forEach(function (p) {
    var models = info.models.filter(function (m) { return m.providerId === p.id && (!state.filter || m.id.toLowerCase().indexOf(state.filter) >= 0); });
    if (!models.length) return;
    var card = el('details', { class: 'card', open: !!state.filter },
      el('summary', null, logo(p.id, 24), el('strong', { text: p.id }), el('span', { class: 'count', text: p.models + ' models' })));
    models.forEach(function (m) {
      var row = el('div', { class: 'model-row', title: 'Click to copy' }, el('span', { text: m.id.slice(p.id.length + 1) + (m.id === info.defaultModel ? '  (default)' : '') }), el('span', { text: m.contextWindow ? Math.round(m.contextWindow / 1000) + 'k' : '' }));
      row.addEventListener('click', function () { copyText(m.id, row.lastChild); });
      card.appendChild(row);
    });
    grid.appendChild(card);
  });
  root.appendChild(grid);
  return root;
}

function renderPane() {
  var pane = $('#pane');
  var top = pane.scrollTop;
  pane.textContent = '';
  if (state.view === 'models') { pane.appendChild(modelsView()); return; }
  if (!state.selected || !state.detail) {
    pane.appendChild(el('div', { class: 'empty' },
      el('p', { text: state.logs.length ? 'Select a request.' : 'Waiting for requests\u2026' }),
      el('p', null, 'Point an OpenAI-compatible client at ', el('code', { text: location.origin + '/v1' }))));
    return;
  }
  pane.appendChild(detailView(state.detail));
  pane.scrollTop = top;
}
function render() {
  $('#nav-requests').className = state.view === 'requests' ? 'active' : '';
  $('#nav-models').className = state.view === 'models' ? 'active' : '';
  $('#list').style.display = state.view === 'requests' ? '' : 'none';
  renderList();
  renderPane();
}

var detailTimer = null, detailBusy = false;
function loadDetail(id) {
  if (detailBusy) return;
  detailBusy = true;
  fetch('/ui/api/logs/' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; }).then(function (e) {
    detailBusy = false;
    if (id !== state.selected) return;
    state.detail = e;
    if (state.view === 'requests') renderPane();
  }).catch(function () { detailBusy = false; });
}
function select(id) {
  state.selected = id; state.detail = null; state.showAllChunks = false;
  history.replaceState(null, '', '#' + id);
  renderList(); renderPane();
  loadDetail(id);
}
function upsert(s) {
  var i = state.logs.findIndex(function (x) { return x.id === s.id; });
  if (i >= 0) state.logs[i] = s;
  else { state.logs.push(s); state.logs.sort(function (a, b) { return b.seq - a.seq; }); }
  if (!state.selected && state.view === 'requests') { select(s.id); return; }
  if (s.id === state.selected && !detailTimer) {
    detailTimer = setTimeout(function () { detailTimer = null; loadDetail(state.selected); }, s.status === 'pending' ? 600 : 50);
  }
  scheduleList();
}
var listQueued = false;
function scheduleList() { if (listQueued) return; listQueued = true; requestAnimationFrame(function () { listQueued = false; renderList(); }); }

function loadLogs() {
  return fetch('/ui/api/logs').then(function (r) { return r.json(); }).then(function (d) {
    state.logs = d.logs;
    var wanted = location.hash.slice(1);
    var pick = state.logs.some(function (l) { return l.id === wanted; }) ? wanted : (state.selected || (state.logs[0] && state.logs[0].id));
    if (pick) select(pick); else render();
  });
}
function connect() {
  var es = new EventSource('/ui/api/events');
  es.onopen = function () { $('#conn').className = 'on'; loadLogs(); };
  es.onerror = function () { $('#conn').className = ''; };
  es.onmessage = function (m) {
    var ev = JSON.parse(m.data);
    if (ev.type === 'clear') { state.logs = []; state.selected = null; state.detail = null; history.replaceState(null, '', location.pathname); render(); }
    else upsert(ev.summary);
  };
}

$('#nav-requests').addEventListener('click', function () { state.view = 'requests'; render(); });
$('#nav-models').addEventListener('click', function () {
  state.view = 'models'; render();
  if (!state.info) fetch('/ui/api/state').then(function (r) { return r.json(); }).then(function (d) { state.info = d; if (state.view === 'models') renderPane(); });
});
$('#filter').addEventListener('input', function (ev) { state.filter = ev.target.value.trim().toLowerCase(); state.view === 'models' ? renderPane() : renderList(); });
$('#clear').addEventListener('click', function () { if (confirm('Clear all logged requests?')) fetch('/ui/api/logs', { method: 'DELETE' }); });

render();
connect();
})();
</script>
</body>
</html>
`;
