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
import type {LadderTier} from '../../server/ladder-model.js';
import {type Ladders, applyLadderEvent, moveWithin, removeRow} from '../ladder-state.js';
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
			setLadders(optimistic(before));
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
			} catch (cause) {
				// Put the row back where it was; a ladder that lies is worse than one
				// that refuses.
				setLadders(before);
				setError(cause instanceof Error ? cause.message : String(cause));
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

	const drop = useCallback(
		(toTier: string) => {
			const nodeId = dragging;
			setDragging(undefined);
			setDropTier(undefined);
			if (!nodeId) {
				return;
			}
			void write('/api/v1/ladder/move', {root, node_id: nodeId, to_tier: toTier}, (current) =>
				moveWithin(current, root, nodeId, toTier),
			);
		},
		[dragging, root, write],
	);

	const complete = useCallback(
		(nodeId: string) => {
			void write('/api/v1/ladder/complete', {root, node_id: nodeId}, (current) => removeRow(current, nodeId));
		},
		[root, write],
	);

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

				{error ? <div className="ladder-error">{error}</div> : null}

				<nav className="ladder-rootnav">
					{roots.map((name) => (
						<button
							aria-selected={name === root}
							key={name}
							onClick={() => setRoot(name)}
							type="button"
						>
							{name}
						</button>
					))}
				</nav>

				{ladder ? (
					<div className="ladder-queue">
						{ladder.tiers.map((tier) => (
							<Tier
								dropping={dropTier === tier.label}
								key={tier.id}
								onComplete={complete}
								onDragEnd={() => {
									setDragging(undefined);
									setDropTier(undefined);
								}}
								onDragOver={() => setDropTier(tier.label)}
								onDragStart={setDragging}
								onDrop={() => drop(tier.label)}
								pending={pending}
								tier={tier}
								dragging={dragging}
							/>
						))}
					</div>
				) : (
					<p className="ladder-dek">{error ? 'Could not load the ladder.' : 'Loading…'}</p>
				)}
			</div>
		</div>
	);
}

interface TierProps {
	tier: LadderTier;
	dragging: string | undefined;
	dropping: boolean;
	pending: Set<string>;
	onDragStart: (nodeId: string) => void;
	onDragEnd: () => void;
	onDragOver: () => void;
	onDrop: () => void;
	onComplete: (nodeId: string) => void;
}

function Tier({tier, dragging, dropping, pending, onDragStart, onDragEnd, onDragOver, onDrop, onComplete}: TierProps) {
	const free = tier.capacity - tier.items.length;
	return (
		<>
			<div className={`ladder-sep ${tier.state}`}>
				<span className="tname">{tier.label}</span>
				<span className="gauge">
					{tier.items.length}/{tier.capacity}
				</span>
				<span className="verdict">{VERDICT[tier.state](tier)}</span>
				{tier.tier <= 2 ? <span className="goal">today&rsquo;s goals</span> : null}
			</div>
			<div
				className={`ladder-zone ${tier.state}${dropping ? ' dropping' : ''}`}
				onDragOver={(event) => {
					event.preventDefault();
					onDragOver();
				}}
				onDrop={(event) => {
					event.preventDefault();
					onDrop();
				}}
			>
				{tier.items.map((item, index) => (
					<div
						className={[
							'ladder-row',
							dragging === item.id ? 'dragging' : '',
							pending.has(item.id) ? 'pending' : '',
							index >= tier.capacity ? 'excess' : '',
						]
							.filter(Boolean)
							.join(' ')}
						draggable
						key={item.id}
						onDragEnd={onDragEnd}
						onDragStart={() => onDragStart(item.id)}
					>
						<span className="grip">⠿</span>
						<span className="rank">{index + 1}</span>
						<span className="txt">{item.name}</span>
						<button
							className="done"
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
