#!/usr/bin/env python3
"""Render a JSON report spec as a styled HTML page, optionally with interactive review.

Usage: python3 render_report.py <input.json> <output.html> [--open] [--serve [PORT]]

Input schema:
{
  "title": "Report title",
  "subtitle": "Optional subtitle line",
  "cards": [
    {
      "heading": "Card heading",
      "href": "https://... (optional link shown top-right)",
      "linkText": "optional link label (defaults to href)",
      "note": "optional italic warning/context line",
      "before": "old text",   // before+after render a word-level diff
      "after": "new text",
      "body": "plain text"    // alternative to before/after
    }
  ]
}

With --serve, a local HTTP server hosts the page and records Accept / Reject /
Later clicks (plus rejection notes) to <output>.decisions.jsonl — one JSON
object per line, latest line per card id wins. Without --serve the buttons
still work, persisting to browser localStorage only.
"""
import difflib
import html
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def diff_spans(before, after):
    """Return (before_html, after_html) with changed words highlighted."""
    # Source text may already contain HTML entities (e.g. Workflowy stores
    # names as HTML, so "&" arrives as "&amp;"). Unescape first so the
    # html.escape below doesn't double-encode them for display.
    before, after = html.unescape(before), html.unescape(after)
    bw, aw = before.split(' '), after.split(' ')
    sm = difflib.SequenceMatcher(None, bw, aw, autojunk=False)
    bout, aout = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        bseg = html.escape(' '.join(bw[i1:i2]))
        aseg = html.escape(' '.join(aw[j1:j2]))
        if op == 'equal':
            bout.append(bseg)
            aout.append(aseg)
        else:
            if bseg:
                bout.append(f'<mark class="del">{bseg}</mark>')
            if aseg:
                aout.append(f'<mark class="ins">{aseg}</mark>')
    return ' '.join(bout), ' '.join(aout)


def card_id(card, index):
    return card.get('linkText') or card.get('href') or f'card-{index}'


def render_card(card, index):
    cid = html.escape(card_id(card, index))
    heading = html.escape(card.get('heading', ''))
    link = ''
    if card.get('href'):
        label = html.escape(card.get('linkText') or card['href'])
        link = f'<a class="cardlink" href="{html.escape(card["href"])}" target="_blank">{label}</a>'
    note = f'<div class="note">⚠️ {html.escape(card["note"])}</div>' if card.get('note') else ''
    if 'before' in card and 'after' in card:
        bh, ah = diff_spans(card['before'], card['after'])
        content = (f'<div class="row before"><span class="label">Before</span><p>{bh}</p></div>'
                   f'<div class="row after"><span class="label">After</span><p>{ah}</p></div>')
    else:
        content = f'<p class="body">{html.escape(html.unescape(card.get("body", "")))}</p>'
    return f'''<div class="card" data-id="{cid}">
    <div class="head"><span class="heading">{heading}</span>{link}</div>
    {note}{content}
    <div class="actions">
      <button class="act accept" onclick="decide(this,'accept')">✅ Accept</button>
      <button class="act reject" onclick="decide(this,'reject')">❌ Reject</button>
      <button class="act later" onclick="decide(this,'later')">⏭️ Later</button>
      <button class="act clear" onclick="decide(this,'clear')">↩︎ Undo</button>
      <input class="reject-note" placeholder="why? (saved with rejection)"
             onkeydown="if(event.key==='Enter'){{event.preventDefault();decide(this,'reject');}}"
             onblur="noteBlur(this)">
    </div>
  </div>'''


def render(spec):
    cards = ''.join(render_card(c, i) for i, c in enumerate(spec.get('cards', [])))
    title = html.escape(spec.get('title', 'Report'))
    subtitle = html.escape(spec.get('subtitle', ''))
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  :root {{
    --bg: #f6f7f9; --card: #ffffff; --text: #1f2430; --muted: #6b7280;
    --del-bg: #fde8e8; --del-fg: #9b1c1c; --ins-bg: #def7e4; --ins-fg: #03543f;
    --accent: #4f46e5; --border: #e5e7eb; --later: #b45309;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #14161b; --card: #1e2128; --text: #e7e9ee; --muted: #9aa1ad;
      --del-bg: #4c1d1d; --del-fg: #fca5a5; --ins-bg: #123c2b; --ins-fg: #6ee7b7;
      --accent: #818cf8; --border: #2d313a; --later: #fbbf24;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 2.5rem 1.5rem 4rem; background: var(--bg); color: var(--text);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }}
  .wrap {{ max-width: 880px; margin: 0 auto; }}
  h1 {{ font-size: 1.6rem; margin: 0 0 .25rem; }}
  .subtitle {{ color: var(--muted); margin-bottom: 1rem; }}
  .toolbar {{
    position: sticky; top: 0; z-index: 5; background: var(--bg);
    padding: .6rem 0; margin-bottom: 1rem; border-bottom: 1px solid var(--border);
    display: flex; gap: .5rem; align-items: center; flex-wrap: wrap;
  }}
  .toolbar button {{
    border: 1px solid var(--border); background: var(--card); color: var(--text);
    border-radius: 999px; padding: .25rem .8rem; cursor: pointer; font-size: .85rem;
  }}
  .toolbar button.active {{ border-color: var(--accent); color: var(--accent); font-weight: 650; }}
  #counts {{ margin-left: auto; font-size: .85rem; color: var(--muted); }}
  .card {{
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 1rem 1.25rem; margin-bottom: 1.1rem; box-shadow: 0 1px 3px rgba(0,0,0,.06);
  }}
  .card.accept {{ border-left: 5px solid var(--ins-fg); opacity: .55; }}
  .card.reject {{ border-left: 5px solid var(--del-fg); opacity: .55; }}
  .card.later  {{ border-left: 5px solid var(--later); opacity: .7; }}
  .head {{ display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .4rem; }}
  .heading {{ font-weight: 650; }}
  .cardlink {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem;
              color: var(--accent); text-decoration: none; }}
  .cardlink:hover {{ text-decoration: underline; }}
  .note {{ font-size: .85rem; color: var(--muted); font-style: italic; margin-bottom: .5rem; }}
  .row {{ display: flex; gap: .75rem; padding: .45rem .6rem; border-radius: 8px; }}
  .row + .row {{ margin-top: .35rem; }}
  .row.before {{ background: color-mix(in srgb, var(--del-bg) 35%, transparent); }}
  .row.after  {{ background: color-mix(in srgb, var(--ins-bg) 35%, transparent); }}
  .label {{
    flex: 0 0 3.6rem; font-size: .7rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); padding-top: .2rem;
  }}
  .row p, p.body {{ margin: 0; }}
  mark.del {{ background: var(--del-bg); color: var(--del-fg); border-radius: 4px; padding: 0 .15em;
             text-decoration: line-through; text-decoration-thickness: 1px; }}
  mark.ins {{ background: var(--ins-bg); color: var(--ins-fg); border-radius: 4px; padding: 0 .15em; font-weight: 600; }}
  .actions {{ display: flex; gap: .5rem; margin-top: .6rem; align-items: center; flex-wrap: wrap; }}
  .act {{
    border: 1px solid var(--border); background: transparent; color: var(--text);
    border-radius: 8px; padding: .3rem .7rem; cursor: pointer; font-size: .85rem;
  }}
  .act:hover {{ border-color: var(--accent); }}
  .reject-note {{
    flex: 1; min-width: 12rem; border: 1px solid var(--border); border-radius: 8px;
    background: transparent; color: var(--text); padding: .3rem .6rem; font-size: .85rem;
  }}
  .card.reject .reject-note {{ border-color: var(--del-fg); }}
  .rnote-display {{ font-size: .85rem; color: var(--del-fg); margin-top: .3rem; }}
</style>
</head>
<body>
<div class="wrap">
  <h1>{title}</h1>
  <div class="subtitle">{subtitle}</div>
  <div class="toolbar">
    <button data-f="all" class="active" onclick="setFilter(this)">All</button>
    <button data-f="undecided" onclick="setFilter(this)">Undecided</button>
    <button data-f="accept" onclick="setFilter(this)">Accepted</button>
    <button data-f="reject" onclick="setFilter(this)">Rejected</button>
    <button data-f="later" onclick="setFilter(this)">Later</button>
    <span id="counts"></span>
  </div>
  {cards}
</div>
<script>
const SERVED = location.protocol.startsWith('http');
const LS_KEY = 'report-decisions:' + document.title;
let filter = 'all';
const session = {{applied: 0, rejected: 0, later: 0, notes: null}};  // live tallies for this session

function localAll() {{
  try {{ return JSON.parse(localStorage.getItem(LS_KEY) || '{{}}'); }} catch (e) {{ return {{}}; }}
}}
function localSave(all) {{ localStorage.setItem(LS_KEY, JSON.stringify(all)); }}

async function persist(payload) {{
  if (SERVED) {{
    try {{
      const r = await fetch('/decision', {{method: 'POST', body: JSON.stringify(payload)}});
      return await r.json();   // {{ok, applied?, error?}}
    }} catch (e) {{ /* fall through to localStorage */ }}
  }}
  const all = localAll();
  all[payload.id] = payload;
  localSave(all);
  return null;
}}

function applyState(card, decision, note) {{
  card.classList.remove('accept', 'reject', 'later');
  card.querySelectorAll('.rnote-display').forEach(el => el.remove());
  if (decision && decision !== 'clear') {{
    card.classList.add(decision);
    if (decision === 'reject' && note) {{
      const d = document.createElement('div');
      d.className = 'rnote-display';
      d.textContent = '❌ ' + note;
      card.querySelector('.actions').after(d);
    }}
  }}
  updateCounts();
  applyFilter();
}}

function noteBlur(el) {{
  // typing a note after rejecting should still save it (static/log-only flow,
  // where the card stays put). Null-safe: the input may already be detached.
  const card = el.closest('.card');
  if (card && card.classList.contains('reject') && el.value.trim()) decide(el, 'reject');
}}

function decide(el, decision) {{
  const card = el.closest('.card');
  if (!card || card.dataset.deciding === '1') return;  // re-entrancy guard (Enter→blur, double-click)
  if (decision !== 'later') card.dataset.deciding = '1';
  const note = decision === 'reject' ? ((card.querySelector('.reject-note') || {{}}).value || '').trim() : '';
  const payload = {{id: card.dataset.id, decision, note,
                   heading: card.querySelector('.heading').textContent}};

  // 'later' marks in place; everything else removes optimistically (no waiting on the network)
  if (decision === 'later') {{ persist(payload); applyState(card, decision, note); return; }}

  const next = card.nextSibling, parent = card.parentNode;
  if (decision === 'reject') session.rejected++; else session.applied++;
  collapseOut(card);
  updateCounts();

  persist(payload).then(resp => {{
    if (resp && resp.stats && typeof resp.stats.pendingNotes === 'number') {{
      session.notes = resp.stats.pendingNotes; updateCounts();
    }}
    if (!resp || resp.applied || decision === 'reject') return;  // keep the optimistic removal
    if (resp.error) {{
      // write actually failed — restore the card, roll back the tally, surface the error
      session.applied--;
      card.removeAttribute('style'); card.classList.remove('accept', 'reject', 'later');
      card.dataset.deciding = '';  // allow a retry
      parent.insertBefore(card, next);
      let e = card.querySelector('.apply-error');
      if (!e) {{ e = document.createElement('div'); e.className = 'apply-error rnote-display'; card.querySelector('.actions').after(e); }}
      e.textContent = '⚠️ ' + resp.error;
      updateCounts();
    }}
  }});
}}

function collapseOut(card) {{
  card.querySelectorAll('.act, .rnote-display, .reject-note').forEach(b => b.remove());
  card.style.transition = 'opacity .15s ease, max-height .15s ease, margin .15s, padding .15s';
  card.style.maxHeight = card.offsetHeight + 'px'; card.style.overflow = 'hidden';
  requestAnimationFrame(() => {{
    card.style.opacity = '0'; card.style.maxHeight = '0'; card.style.margin = '0'; card.style.padding = '0';
  }});
  setTimeout(() => {{ if (card.parentNode && card.style.opacity === '0') card.remove(); }}, 170);
}}

function updateCounts() {{
  // Live session tallies (removed cards no longer live in the DOM, so we count actions, not cards).
  const onPage = document.querySelectorAll('.card').length;
  const laterOnPage = document.querySelectorAll('.card.later').length;
  const notes = session.notes == null ? '' : ` · 📝 ${{session.notes}} notes queued`;
  document.getElementById('counts').textContent =
    `this session: ✅ ${{session.applied}} · ❌ ${{session.rejected}}${{notes}} · ⏳ ${{onPage - laterOnPage}} left on page`;
}}

function setFilter(btn) {{
  filter = btn.dataset.f;
  document.querySelectorAll('.toolbar button').forEach(b => b.classList.toggle('active', b === btn));
  applyFilter();
}}

function applyFilter() {{
  document.querySelectorAll('.card').forEach(card => {{
    const state = ['accept','reject','later'].find(s => card.classList.contains(s)) || 'undecided';
    card.style.display = (filter === 'all' || filter === state) ? '' : 'none';
  }});
}}

async function restore() {{
  let decisions = {{}};
  if (SERVED) {{
    try {{ decisions = await (await fetch('/decisions')).json(); }} catch (e) {{ decisions = localAll(); }}
  }} else {{
    decisions = localAll();
  }}
  for (const [id, d] of Object.entries(decisions)) {{
    const card = document.querySelector(`.card[data-id="${{CSS.escape(id)}}"]`);
    if (!card || !d.decision || d.decision === 'clear') continue;
    if (d.note) card.querySelector('.reject-note').value = d.note;
    applyState(card, d.decision, d.note || '');
  }}
  updateCounts();
}}
restore();
</script>
</body>
</html>'''


def latest_decisions(jsonl_path):
    """Collapse the JSONL log to the latest decision per card id."""
    decisions = {}
    if jsonl_path.exists():
        for line in jsonl_path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            decisions[d.get('id')] = d
    return decisions


def run_apply(apply_cmd, decision):
    """Run the configured apply command for one decision, returning its JSON.

    apply_cmd is a list template; {id}/{decision}/{note} tokens are substituted.
    The command must print a JSON object; a "removed" field becomes "applied".
    """
    import shlex
    argv = [t.format(id=decision['id'], decision=decision['decision'],
                     note=decision.get('note', '')) for t in apply_cmd]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=60)
        result = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception as e:  # noqa: BLE001
        return {'ok': False, 'error': f'apply failed: {e}'}
    return {'ok': result.get('ok', False), 'applied': result.get('removed', False),
            'error': result.get('error'), 'stats': result.get('stats')}


def serve(html_path, jsonl_path, port, apply_cmd=None, host='127.0.0.1'):
    page = html_path.read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code, body, ctype='application/json'):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_head(self, code, length, ctype):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(length))
            self.end_headers()

        def do_HEAD(self):
            if self.path == '/decisions':
                body = json.dumps(latest_decisions(jsonl_path)).encode()
                self._send_head(200, len(body), 'application/json')
            else:
                self._send_head(200, len(page), 'text/html; charset=utf-8')

        def do_GET(self):
            if self.path == '/decisions':
                self._send(200, json.dumps(latest_decisions(jsonl_path)).encode())
            else:
                self._send(200, page, 'text/html; charset=utf-8')

        def do_POST(self):
            if self.path != '/decision':
                self._send(404, b'{}')
                return
            length = int(self.headers.get('Content-Length', 0))
            try:
                d = json.loads(self.rfile.read(length))
                assert d.get('id') and d.get('decision') in ('accept', 'reject', 'later', 'clear')
            except Exception:
                self._send(400, b'{"error": "bad payload"}')
                return
            with open(jsonl_path, 'a') as f:
                f.write(json.dumps(d, ensure_ascii=False) + '\n')
            if apply_cmd:
                self._send(200, json.dumps(run_apply(apply_cmd, d)).encode())
            else:
                self._send(200, b'{"ok": true}')

    server = ThreadingHTTPServer((host, port), Handler)
    mode = 'apply-on-click' if apply_cmd else 'log-only'
    print(f"serving on http://{host}:{port}/ ({mode}) — decisions append to {jsonl_path}")
    server.serve_forever()


def parse_args(argv):
    """Parse positional input/output paths plus --open / --serve [port] / --apply-cmd flags."""
    positional, serve_mode, port, apply_cmd, host = [], False, 8765, None, '127.0.0.1'
    tokens = list(argv)
    while tokens:
        token = tokens.pop(0)
        if token == '--serve':
            serve_mode = True
            if tokens and tokens[0].isdigit():
                port = int(tokens.pop(0))
        elif token == '--apply-cmd':
            apply_cmd = tokens.pop(0) if tokens else None  # shell-style template string
        elif token == '--host':
            host = tokens.pop(0) if tokens else host  # e.g. 0.0.0.0 to reach over Tailscale/LAN
        elif token.startswith('--'):
            continue
        else:
            positional.append(token)
    open_browser = '--open' in argv
    return positional, serve_mode, port, open_browser, apply_cmd, host


def main():
    import shlex
    positional, serve_mode, port, open_browser, apply_cmd, host = parse_args(sys.argv[1:])
    if len(positional) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    input_path, output_path = Path(positional[0]), Path(positional[1])
    with open(input_path) as f:
        spec = json.load(f)
    page = render(spec)
    with open(output_path, 'w') as f:
        f.write(page)
    print(f"wrote {output_path} with {len(spec.get('cards', []))} cards")

    if open_browser:
        local = '127.0.0.1' if host in ('0.0.0.0', '::') else host
        target = f'http://{local}:{port}/' if serve_mode else str(output_path)
        subprocess.run(['open', target])
    if serve_mode:
        cmd = shlex.split(apply_cmd) if apply_cmd else None
        serve(output_path, output_path.with_suffix('.decisions.jsonl'), port, cmd, host)


if __name__ == '__main__':
    main()
