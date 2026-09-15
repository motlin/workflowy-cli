/**
 * The asap ladder, drag-and-drop, writing straight through to Workflowy.
 *
 * The published-artifact version of this page had to queue every move into a
 * localStorage draft and apply the batch later, because an artifact cannot call
 * out to anything. That draft is what silently emptied a tier the user never
 * touched. Here a drop is a POST: there is no draft to go stale, and the server
 * broadcasts each write so every open tab (and any Claude session watching the
 * socket) sees it immediately.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {LadderEvent} from '../../server/ladder-events.js';
import {type LadderTier, tierLabel} from '../../server/ladder-model.js';
import {
	type Ladders,
	applyLadderEvent,
	ladderMoveSelection,
	moveWithin,
	removeRow,
	selectLadderRange,
	tierOf,
} from '../ladder-state.js';
import {type Point, autoScrollBy, isDragGesture, tierAtPoint} from '../pointer-drag.js';
import '../ladder.css';

const VERDICT: Record<LadderTier['state'], (tier: LadderTier) => string> = {
	room: (tier) => `room for ${tier.capacity - tier.items.length}`,
	exact: () => 'at cap',
	over: (tier) => `over by ${tier.items.length - tier.capacity}`,
};

export function LadderView() {
	const [ladders, setLadders] = useState<Ladders>();
	const [root, setRoot] = useState('personal');
	const [error, setError] = useState<string>();
	const [live, setLive] = useState(false);
	const [dragging, setDragging] = useState<string>();
	const [dropTier, setDropTier] = useState<string>();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const anchor = useRef<string>(undefined);
	const busy = useRef(false);
	const [saving, setSaving] = useState(false);
	const [needsReload, setNeedsReload] = useState(false);
	const [pending, setPending] = useState<Set<string>>(new Set());
	const laddersRef = useRef<Ladders | undefined>(undefined);
	laddersRef.current = ladders;

	useEffect(() => {
		void (async () => {
			try {
				const response = await fetch('/api/v1/ladder');
				if (!response.ok) {
					throw new Error(`ladder request failed: ${response.status}`);
				}
				const body = (await response.json()) as {ladders: Ladders};
				setLadders(body.ladders);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		})();
	}, []);

	// Every write, from this tab or any other, arrives here as one frame.
	useEffect(() => {
		const protocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws';
		const socket = new WebSocket(`${protocol}://${globalThis.location.host}/api/v1/ladder/events`);
		socket.addEventListener('open', () => setLive(true));
		socket.addEventListener('close', () => setLive(false));
		socket.addEventListener('message', (message: MessageEvent<string>) => {
			const event = JSON.parse(message.data) as LadderEvent;
			setLadders((current) => (current ? applyLadderEvent(current, event) : current));
		});
		return () => socket.close();
	}, []);

	const write = useCallback(
		async (path: string, body: Record<string, string>, optimistic: (current: Ladders) => Ladders) => {
			const before = laddersRef.current;
			if (!before) {
				return;
			}
			const nodeId = body.node_id;
			setError(undefined);
			laddersRef.current = optimistic(before);
			setLadders(laddersRef.current);
			setPending((current) => new Set(current).add(nodeId));
			try {
				const response = await fetch(path, {
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify(body),
				});
				if (!response.ok) {
					const failure = (await response.json()) as {error?: string};
					throw new Error(failure.error ?? `write failed: ${response.status}`);
				}
				return true;
			} catch (cause) {
				// Put the row back where it was; a ladder that lies is worse than one
				// that refuses.
				laddersRef.current = before;
				setLadders(before);
				setError(cause instanceof Error ? cause.message : String(cause));
				return false;
			} finally {
				setPending((current) => {
					const next = new Set(current);
					next.delete(nodeId);
					return next;
				});
			}
		},
		[],
	);

	const move = useCallback(
		(nodeId: string, toTier: string) => {
			const ladder = laddersRef.current?.[root];
			if (busy.current || !ladder) return;
			busy.current = true;
			setSaving(true);
			const ids = ladderMoveSelection(ladder, selected, nodeId);
			void (async () => {
				try {
					for (const id of ids) {
						const current = laddersRef.current;
						if (!current || tierOf(current, root, id) === toTier) continue;
						const saved = await write(
							'/api/v1/ladder/move',
							{root, node_id: id, to_tier: toTier},
							(ladders) => moveWithin(ladders, root, id, toTier),
						);
						if (!saved) break;
					}
				} finally {
					busy.current = false;
					setSaving(false);
				}
			})();
		},
		[root, selected, write],
	);

	// One pointer gesture, mouse or finger. The row itself stays scrollable; only
	// the grip claims the pointer stream, so a swipe anywhere else still scrolls
	// the page on a phone.
	const gesture = useRef<{nodeId: string; origin: Point; started: boolean}>(undefined);
	const [ghost, setGhost] = useState<{x: number; y: number; name: string}>();

	const onGripDown = useCallback((event: React.PointerEvent, item: {id: string; name: string}) => {
		if (event.button !== 0 && event.pointerType === 'mouse') {
			return;
		}
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		gesture.current = {nodeId: item.id, origin: {x: event.clientX, y: event.clientY}, started: false};
	}, []);

	const onGripMove = useCallback((event: React.PointerEvent, name: string) => {
		const active = gesture.current;
		if (!active) {
			return;
		}
		const at = {x: event.clientX, y: event.clientY};
		if (!active.started) {
			if (!isDragGesture(active.origin, at)) {
				return;
			}
			active.started = true;
			setDragging(active.nodeId);
		}
		// The grip has touch-action: none, so nothing else is going to scroll for
		// us once a drag is under way.
		const by = autoScrollBy(at.y, globalThis.innerHeight);
		if (by !== 0) {
			globalThis.scrollBy(0, by);
		}
		setGhost({x: at.x, y: at.y, name});
		setDropTier(tierAtPoint(at.x, at.y));
	}, []);

	const onGripUp = useCallback(
		(event: React.PointerEvent) => {
			const active = gesture.current;
			gesture.current = undefined;
			setGhost(undefined);
			setDragging(undefined);
			const toTier = tierAtPoint(event.clientX, event.clientY);
			setDropTier(undefined);
			if (active?.started && toTier) {
				move(active.nodeId, toTier);
			}
		},
		[move],
	);

	const complete = useCallback(
		(nodeId: string) => {
			if (busy.current) return;
			busy.current = true;
			setSaving(true);
			void write('/api/v1/ladder/complete', {root, node_id: nodeId}, (current) =>
				removeRow(current, nodeId),
			).finally(() => {
				busy.current = false;
				setSaving(false);
			});
		},
		[root, write],
	);

	const select = (nodeId: string, range: boolean) => {
		const ladder = laddersRef.current?.[root];
		if (!ladder) return;
		if (range && anchor.current) {
			setSelected(selectLadderRange(ladder, anchor.current, nodeId));
		} else {
			anchor.current = nodeId;
			setSelected((current) => {
				const next = new Set(current);
				if (next.has(nodeId)) next.delete(nodeId);
				else next.add(nodeId);
				return next;
			});
		}
	};

	const addTier = async () => {
		const ladder = laddersRef.current?.[root];
		if (!ladder || busy.current) return;
		busy.current = true;
		setSaving(true);
		setError(undefined);
		try {
			const response = await fetch('/api/v1/nodes', {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify({
					parent_id: ladder.bucketId,
					name: tierLabel((ladder.tiers.at(-1)?.tier ?? 0) + 1),
					position: 0,
				}),
			});
			if (!response.ok) throw new Error(`Could not add a tier: ${response.status}`);
			setNeedsReload(true);
			const refreshed = await fetch('/api/v1/ladder');
			if (!refreshed.ok)
				throw new Error(
					`Tier created; could not refresh ladder: ${refreshed.status}. Reload before adding another.`,
				);
			const body = (await refreshed.json()) as {ladders: Ladders};
			laddersRef.current = body.ladders;
			setLadders(body.ladders);
			setNeedsReload(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			busy.current = false;
			setSaving(false);
		}
	};

	const roots = useMemo(() => Object.keys(ladders ?? {}), [ladders]);
	const ladder = ladders?.[root];

	return (
		<div className="ladder-page">
			<div className="ladder-wrap">
				<header className="ladder-head">
					<h1>Asap ladder</h1>
					<p className="ladder-dek">
						Drag a row into another tier to refile it. Each tier holds 2<sup>k</sup>, fixed, so finishing
						work never pushes anything out of a tier above.
					</p>
					<p
						className="ladder-live"
						data-live={live ? 'on' : 'off'}
					>
						{live ? 'Live — every write is broadcast as it lands' : 'Reconnecting to the write stream'}
					</p>
				</header>

				<p className="ladder-dek">
					Select rows to move together; shift-click selects a range. Moves and Done save immediately.
				</p>
				{error ? <div className="ladder-error">{error}</div> : null}

				<nav className="ladder-rootnav">
					{roots.map((name) => (
						<button
							aria-selected={name === root}
							key={name}
							disabled={saving}
							onClick={() => {
								setRoot(name);
								setSelected(new Set());
								anchor.current = undefined;
							}}
							type="button"
						>
							{name}
						</button>
					))}
				</nav>

				{ladder ? (
					<div className="ladder-queue">
						{ladder.tiers.map((tier, index) => (
							<Tier
								dropping={dropTier === tier.label}
								key={tier.id}
								nextTier={ladder.tiers[index + 1]?.label}
								onStep={move}
								previousTier={ladder.tiers[index - 1]?.label}
								onComplete={complete}
								onGripDown={onGripDown}
								onGripMove={onGripMove}
								onGripUp={onGripUp}
								pending={pending}
								selected={selected}
								onSelect={select}
								saving={saving}
								tier={tier}
								dragging={dragging}
							/>
						))}
						<button
							type="button"
							disabled={saving || needsReload}
							onClick={() => void addTier()}
						>
							Add bottom tier
						</button>
					</div>
				) : (
					<p className="ladder-dek">{error ? 'Could not load the ladder.' : 'Loading…'}</p>
				)}
			</div>
			{ghost ? (
				<div
					className="ladder-ghost"
					style={{left: ghost.x, top: ghost.y}}
				>
					{ghost.name}
				</div>
			) : null}
		</div>
	);
}

interface TierProps {
	tier: LadderTier;
	dragging: string | undefined;
	dropping: boolean;
	pending: Set<string>;
	selected: Set<string>;
	onSelect: (nodeId: string, range: boolean) => void;
	saving: boolean;
	/** Neighbouring tier labels, so the step buttons know where up and down are. */
	previousTier: string | undefined;
	nextTier: string | undefined;
	onComplete: (nodeId: string) => void;
	onStep: (nodeId: string, toTier: string) => void;
	onGripDown: (event: React.PointerEvent, item: {id: string; name: string}) => void;
	onGripMove: (event: React.PointerEvent, name: string) => void;
	onGripUp: (event: React.PointerEvent) => void;
}

function Tier({
	tier,
	dragging,
	dropping,
	pending,
	selected,
	onSelect,
	saving,
	previousTier,
	nextTier,
	onComplete,
	onStep,
	onGripDown,
	onGripMove,
	onGripUp,
}: TierProps) {
	const free = tier.capacity - tier.items.length;
	return (
		<>
			{/*
			 * The separator carries data-tier too. It is sticky, so on a phone it
			 * covers the top of its own zone -- a drop aimed just below a tier name
			 * would otherwise land on nothing and be silently discarded.
			 */}
			<div
				className={`ladder-sep ${tier.state}${dropping ? ' dropping' : ''}`}
				data-tier={tier.label}
			>
				<span className="tname">{tier.label}</span>
				<span className="gauge">
					{tier.items.length}/{tier.capacity}
				</span>
				<span className="verdict">{VERDICT[tier.state](tier)}</span>
				{tier.tier <= 2 ? <span className="goal">today&rsquo;s goals</span> : null}
			</div>
			<div
				className={`ladder-zone ${tier.state}${dropping ? ' dropping' : ''}`}
				data-tier={tier.label}
			>
				{tier.items.map((item, index) => (
					<div
						className={[
							'ladder-row',
							selected.has(item.id) ? 'selected' : '',
							dragging === item.id ? 'dragging' : '',
							pending.has(item.id) ? 'pending' : '',
							index >= tier.capacity ? 'excess' : '',
						]
							.filter(Boolean)
							.join(' ')}
						key={item.id}
					>
						<span
							className="grip"
							onPointerCancel={onGripUp}
							onPointerDown={(event) => onGripDown(event, item)}
							onPointerMove={(event) => onGripMove(event, item.name)}
							onPointerUp={onGripUp}
							role="presentation"
						>
							&#10303;
						</span>
						<button
							type="button"
							aria-label={`Select ${item.name}`}
							aria-pressed={selected.has(item.id)}
							disabled={saving}
							onClick={(event) => onSelect(item.id, event.shiftKey)}
						>
							{selected.has(item.id) ? '☑' : '☐'}
						</button>
						<span className="rank">{index + 1}</span>
						<span className="txt">{item.name}</span>
						<span className="step">
							<button
								aria-label={`Move to ${previousTier ?? 'the tier above'}`}
								disabled={saving || !previousTier}
								onClick={() => previousTier && onStep(item.id, previousTier)}
								type="button"
							>
								&#9650;
							</button>
							<button
								aria-label={`Move to ${nextTier ?? 'the tier below'}`}
								disabled={saving || !nextTier}
								onClick={() => nextTier && onStep(item.id, nextTier)}
								type="button"
							>
								&#9660;
							</button>
						</span>
						<button
							className="done"
							disabled={saving}
							onClick={() => onComplete(item.id)}
							type="button"
						>
							Done
						</button>
					</div>
				))}
				{free > 0 ? (
					<div className="ladder-slot">
						{free} open {free === 1 ? 'slot' : 'slots'}
					</div>
				) : null}
			</div>
		</>
	);
}
