// Renders both asap ladders as one drag-and-drop page, and diffs the page's submission back into
// node create / node move ops.
//
// A tier with more occupants than AskUserQuestion can show (4 options) cannot be ranked through a
// question at all -- a partial list is not a ranking question. This is the surface that replaces it.
//
// The layout is ONE continuous list per ladder with tier boundaries drawn inside it, not a stack of
// per-tier boxes. That distinction is load-bearing: when each tier was its own box sized to its
// contents, an empty tier collapsed to an undroppable sliver, which broke the one repair the
// rebalance phase needs most -- pulling an item UP into an empty high tier. As spans between
// boundaries in a single drag context, an empty tier is a valid drop target by construction.

import {readFileSync} from 'node:fs';
import {readLadder} from './asap-tiers.mjs';

/** Strip Workflowy HTML down to display text, keeping links as their anchor text. */
export function displayText(name) {
	return String(name ?? '')
		.replace(/<a[^>]*>(.*?)<\/a>/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.trim();
}

/** One ladder, flattened for the page: every tier present, empty ones included. */
export function buildLadderModel(root, bucket) {
	const ladder = readLadder(bucket);
	return {
		root,
		bucketId: ladder.bucketId,
		tiers: ladder.tiers.map((t) => ({
			tier: t.tier,
			label: t.label,
			id: t.id,
			capacity: t.capacity,
			items: t.items.map((n) => ({id: n.id, shortId: n.shortId ?? null, text: displayText(n.name)})),
		})),
	};
}

/**
 * Ops to turn the live ladders into what the page submitted: tier creates first (a move needs its
 * destination to exist), then one move per item whose tier actually changed.
 */
export function diffSubmission(models, submission) {
	const ops = [];
	const moves = [];

	for (const model of models) {
		const submitted = submission?.roots?.[model.root];
		if (!submitted) continue;

		const wasIn = new Map();
		for (const tier of model.tiers) for (const item of tier.items) wasIn.set(item.id, tier.label);
		const textOf = new Map();
		for (const tier of model.tiers) for (const item of tier.items) textOf.set(item.id, item.text);

		for (const tier of submitted.tiers ?? []) {
			if (tier.isNew) {
				ops.push({
					op: 'create',
					root: model.root,
					bucketId: submitted.bucketId,
					label: tier.label,
					tier: tier.tier,
				});
			}
			for (const nodeId of tier.items ?? []) {
				if (wasIn.get(nodeId) === tier.label) continue;
				moves.push({
					op: 'move',
					root: model.root,
					nodeId,
					text: textOf.get(nodeId) ?? nodeId,
					fromLabel: wasIn.get(nodeId) ?? null,
					toLabel: tier.label,
					toId: tier.id,
					toIsNew: Boolean(tier.isNew),
				});
			}
		}
	}
	return [...ops, ...moves];
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderLadder(model) {
	const rows = model.tiers
		.map((tier) => {
			const items = tier.items
				.map(
					(item) => `
        <li class="row" draggable="true" data-node-id="${esc(item.id)}">
          <span class="handle" aria-hidden="true">⠿</span>
          <span class="row-text">${esc(item.text)}</span>
          <span class="row-nudge">
            <button type="button" class="nudge" data-dir="-1" title="Move up a tier">▲</button>
            <button type="button" class="nudge" data-dir="1" title="Move down a tier">▼</button>
          </span>
        </li>`,
				)
				.join('');
			return `
      <li class="boundary" data-tier-boundary="${tier.tier}">
        <span class="boundary-label">${esc(tier.label)}</span>
        <span class="meter" data-meter="${tier.tier}"></span>
        <span class="chip" data-chip="${tier.tier}"></span>
      </li>
      <li class="span" data-tier-span="${tier.tier}" data-drop-target="true" data-capacity="${tier.capacity}" data-tier-id="${esc(tier.id ?? '')}" data-is-new="false">
        <ul class="span-items">${items}</ul>
        <p class="empty-note">empty — drop here</p>
      </li>`;
		})
		.join('');

	return `
  <section class="ladder" data-root="${esc(model.root)}" data-bucket-id="${esc(model.bucketId ?? '')}">
    <h2>${esc(model.root)}<span class="over-count" data-over-count></span></h2>
    <ul class="ladder-list">${rows}</ul>
    <button type="button" class="add-tier">+ Add next tier</button>
  </section>`;
}

export function renderPage(models) {
	return `<title>Asap Ladder Rebalance</title>
<style>
  :root {
    --tier-min-drop-height: 44px;
    --bg: #faf9f7; --fg: #1c1b19; --muted: #6b6862; --line: #ddd9d2;
    --card: #ffffff; --accent: #3b6ea5; --over: #b3402f; --ok: #2f7d4f; --land: #8a6d1f;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #17181a; --fg: #e9e7e3; --muted: #9a968f; --line: #33353a;
      --card: #1f2124; --accent: #7aa7d9; --over: #e08472; --ok: #79c295; --land: #d8bb63;
    }
  }
  :root[data-theme="dark"] {
    --bg: #17181a; --fg: #e9e7e3; --muted: #9a968f; --line: #33353a;
    --card: #1f2124; --accent: #7aa7d9; --over: #e08472; --ok: #79c295; --land: #d8bb63;
  }
  body { background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 0 0 96px; }
  header { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; padding: 16px; align-items: start; }
  .ladder h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 8px; display: flex; justify-content: space-between; }
  .ladder-list { list-style: none; margin: 0; padding: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .boundary { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: color-mix(in srgb, var(--accent) 9%, transparent); border-top: 2px solid var(--accent); font-size: 12px; font-weight: 600; position: sticky; top: 46px; }
  .boundary:first-child { border-top: 0; }
  .boundary-label { min-width: 34px; }
  .meter { flex: 1; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .meter i { display: block; height: 100%; background: var(--accent); }
  .chip { font-size: 11px; font-weight: 500; color: var(--muted); white-space: nowrap; }
  .chip.over { color: var(--over); } .chip.exact { color: var(--ok); } .chip.landing { color: var(--land); }
  .span { min-height: var(--tier-min-drop-height); padding: 2px 0; }
  .span.drag-over { background: color-mix(in srgb, var(--accent) 14%, transparent); box-shadow: inset 0 0 0 2px var(--accent); }
  .span-items { list-style: none; margin: 0; padding: 0; }
  .empty-note { display: none; margin: 0; padding: 12px; color: var(--muted); font-style: italic; font-size: 12px; }
  .span[data-empty="true"] .empty-note { display: block; }
  .row { display: flex; gap: 8px; align-items: flex-start; padding: 7px 12px; border-top: 1px solid var(--line); background: var(--card); cursor: grab; }
  .row:first-child { border-top: 0; }
  .row.dragging { opacity: .4; }
  .handle { color: var(--muted); cursor: grab; user-select: none; padding-top: 1px; }
  .row-text { flex: 1; overflow-wrap: anywhere; }
  .row-nudge { display: flex; gap: 2px; }
  .nudge { background: none; border: 1px solid var(--line); color: var(--muted); border-radius: 4px; cursor: pointer; font-size: 10px; line-height: 1; padding: 3px 5px; }
  .nudge:hover { color: var(--fg); border-color: var(--accent); }
  .add-tier { margin-top: 8px; background: none; border: 1px dashed var(--line); color: var(--muted); border-radius: 8px; padding: 8px 12px; cursor: pointer; width: 100%; }
  .add-tier:hover { color: var(--fg); border-color: var(--accent); }
  button.primary { background: var(--accent); color: #fff; border: 0; border-radius: 7px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  button.ghost { background: none; border: 1px solid var(--line); color: var(--fg); border-radius: 7px; padding: 8px 14px; cursor: pointer; }
  #status { color: var(--muted); font-size: 12px; }
  #fallback { margin: 16px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
  #fallback textarea { width: 100%; min-height: 180px; font-family: ui-monospace, Menlo, monospace; font-size: 11px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
</style>
<header>
  <h1>Asap Ladder Rebalance</h1>
  <button type="button" class="primary" id="submit">Submit</button>
  <button type="button" class="ghost" id="reset">Reset</button>
  <span id="status"></span>
</header>
<div class="grid">${models.map(renderLadder).join('')}</div>
<div id="fallback" hidden>
  <p><strong>Could not save to the artifact store.</strong> Copy this and paste it back to Claude:</p>
  <textarea readonly id="fallback-json"></textarea>
</div>
<script>
const INITIAL = ${JSON.stringify(models)};
const DRAFT_KEY = 'asap-rebalance-draft-v1';

function spans(ladder) { return [...ladder.querySelectorAll('.span')]; }

function refresh() {
  for (const ladder of document.querySelectorAll('.ladder')) {
    let over = 0;
    const all = spans(ladder);
    all.forEach((span, idx) => {
      const items = span.querySelectorAll('.row').length;
      const cap = Number(span.dataset.capacity);
      const isBottom = idx === all.length - 1;
      span.dataset.empty = items === 0 ? 'true' : 'false';
      const tier = span.dataset.tierSpan;
      const meter = ladder.querySelector('[data-meter="' + tier + '"]');
      const chip = ladder.querySelector('[data-chip="' + tier + '"]');
      if (meter) meter.innerHTML = '<i style="width:' + Math.min(100, (items / cap) * 100) + '%"></i>';
      if (chip) {
        chip.className = 'chip';
        if (isBottom && items > cap) { chip.textContent = items + '/' + cap + ' · landing'; chip.classList.add('landing'); }
        else if (items > cap) { chip.textContent = items + '/' + cap + ' · over by ' + (items - cap); chip.classList.add('over'); over++; }
        else if (items === cap) { chip.textContent = items + '/' + cap + ' · exact'; chip.classList.add('exact'); }
        else { chip.textContent = items + '/' + cap + ' · ' + (cap - items) + ' free'; }
      }
    });
    const badge = ladder.querySelector('[data-over-count]');
    if (badge) badge.textContent = over ? over + ' over cap' : 'in shape';
  }
  saveDraft();
}

function collect() {
  const roots = {};
  for (const ladder of document.querySelectorAll('.ladder')) {
    roots[ladder.dataset.root] = {
      bucketId: ladder.dataset.bucketId,
      tiers: spans(ladder).map((span) => ({
        tier: Number(span.dataset.tierSpan),
        label: ladder.querySelector('[data-tier-boundary="' + span.dataset.tierSpan + '"] .boundary-label').textContent,
        id: span.dataset.tierId || null,
        isNew: span.dataset.isNew === 'true',
        items: [...span.querySelectorAll('.row')].map((r) => r.dataset.nodeId),
      })),
    };
  }
  return {submittedAt: new Date().toISOString(), roots};
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); } catch {}
}

function applyArrangement(state) {
  for (const ladder of document.querySelectorAll('.ladder')) {
    const submitted = state.roots?.[ladder.dataset.root];
    if (!submitted) continue;
    const byId = new Map([...ladder.querySelectorAll('.row')].map((r) => [r.dataset.nodeId, r]));
    for (const tier of submitted.tiers) {
      let span = ladder.querySelector('[data-tier-span="' + tier.tier + '"]');
      if (!span) span = addTier(ladder, tier.label, tier.tier);
      const list = span.querySelector('.span-items');
      for (const id of tier.items) { const row = byId.get(id); if (row) list.appendChild(row); }
    }
  }
  refresh();
}

function addTier(ladder, label, tier) {
  const list = ladder.querySelector('.ladder-list');
  const boundary = document.createElement('li');
  boundary.className = 'boundary';
  boundary.dataset.tierBoundary = String(tier);
  boundary.innerHTML = '<span class="boundary-label"></span><span class="meter" data-meter="' + tier + '"></span><span class="chip" data-chip="' + tier + '"></span>';
  boundary.querySelector('.boundary-label').textContent = label;
  const span = document.createElement('li');
  span.className = 'span';
  span.dataset.tierSpan = String(tier);
  span.dataset.dropTarget = 'true';
  span.dataset.isNew = 'true';
  span.dataset.capacity = String(Math.pow(2, tier));
  span.innerHTML = '<ul class="span-items"></ul><p class="empty-note">empty — drop here</p>';
  list.append(boundary, span);
  wireSpan(span);
  return span;
}

let dragging = null;

function wireSpan(span) {
  span.addEventListener('dragover', (e) => { e.preventDefault(); span.classList.add('drag-over'); });
  span.addEventListener('dragleave', () => span.classList.remove('drag-over'));
  span.addEventListener('drop', (e) => {
    e.preventDefault();
    span.classList.remove('drag-over');
    if (!dragging) return;
    const list = span.querySelector('.span-items');
    const after = [...list.querySelectorAll('.row:not(.dragging)')].find((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
    if (after) list.insertBefore(dragging, after); else list.appendChild(dragging);
    refresh();
  });
}

function wireRow(row) {
  row.addEventListener('dragstart', () => { dragging = row; row.classList.add('dragging'); });
  row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragging = null; refresh(); });
}

// Tier ids are rendered per ladder in the markup -- deriving them here from a flattened
// INITIAL would hand the second ladder the first ladder's tier ids, sending its moves into
// the wrong bucket.
document.querySelectorAll('.span').forEach(wireSpan);
document.querySelectorAll('.row').forEach(wireRow);

document.addEventListener('click', (e) => {
  const nudge = e.target.closest('.nudge');
  if (nudge) {
    const row = nudge.closest('.row');
    const ladder = row.closest('.ladder');
    const all = spans(ladder);
    const here = all.indexOf(row.closest('.span'));
    const next = all[here + Number(nudge.dataset.dir)];
    if (next) { next.querySelector('.span-items').appendChild(row); refresh(); }
    return;
  }
  const add = e.target.closest('.add-tier');
  if (add) {
    const ladder = add.closest('.ladder');
    const last = spans(ladder).at(-1);
    const tier = Number(last.dataset.tierSpan) + 1;
    const n = tier % 100 >= 11 && tier % 100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'}[tier % 10] ?? 'th');
    addTier(ladder, tier + n, tier);
    refresh();
  }
});

document.getElementById('reset').addEventListener('click', () => {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
  location.reload();
});

document.getElementById('submit').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const payload = collect();
  status.textContent = 'Saving…';
  const db = await claude.use('db');
  if (!db) {
    document.getElementById('fallback').hidden = false;
    document.getElementById('fallback-json').value = JSON.stringify(payload, null, 2);
    status.textContent = 'Store unavailable — copy the JSON below.';
    return;
  }
  try {
    await db.doc('rebalance/submission').set(payload);
    status.textContent = 'Saved ' + new Date().toLocaleTimeString() + ' — tell Claude to apply it.';
  } catch (err) {
    document.getElementById('fallback').hidden = false;
    document.getElementById('fallback-json').value = JSON.stringify(payload, null, 2);
    status.textContent = 'Save failed (' + (err?.code ?? 'error') + ') — copy the JSON below.';
  }
});

try {
  const draft = localStorage.getItem(DRAFT_KEY);
  if (draft) applyArrangement(JSON.parse(draft));
} catch {}
refresh();
</script>`;
}

function main() {
	const [, , ...args] = process.argv;
	const files = args.filter((a) => !a.startsWith('--'));
	const models = files.map((file) => {
		const parsed = JSON.parse(readFileSync(file, 'utf8'));
		const bucket = Array.isArray(parsed) ? parsed[0] : parsed;
		const root = /personal/i.test(bucket?.name ?? file) ? 'personal' : 'work';
		return buildLadderModel(root, bucket);
	});
	process.stdout.write(renderPage(models));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
