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
	restoreRow,
	selectLadderRange,
	tierOf,
} from '../ladder-state.js';
import {type Point, type DropTarget, autoScrollBy, isDragGesture, dropAtPoint} from '../pointer-drag.js';
import {LadderTree} from './ladder-tree.js';
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
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
	const [live, setLive] = useState(false);
	const [dragging, setDragging] = useState<string>();
	const [dropTarget, setDropTarget] = useState<DropTarget>();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const anchor = useRef<string>(undefined);
	const busy = useRef(false);
	const [saving, setSaving] = useState(false);
	const [needsReload, setNeedsReload] = useState(false);
	const [pending, setPending] = useState<Set<string>>(new Set());
	const receivedWrites = useRef(new Map<string, LadderEvent>());
	const laddersRef = useRef<Ladders | undefined>(undefined);
	laddersRef.current = ladders;
	const updateLadders = useCallback((update: (current: Ladders) => Ladders) => {
		if (!laddersRef.current) return;
		laddersRef.current = update(laddersRef.current);
		setLadders(laddersRef.current);
	}, []);

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
			receivedWrites.current.set(event.nodeId, event);
			updateLadders((current) => applyLadderEvent(current, event));
		});
		return () => socket.close();
	}, [updateLadders]);

	const write = useCallback(
		async (path: string, body: Record<string, string>, optimistic: (current: Ladders) => Ladders) => {
			const before = laddersRef.current;
			if (!before) {
				return;
			}
			const nodeId = body.node_id;
			const lastReceived = receivedWrites.current.get(nodeId);
			setRowErrors((current) => {
				const next = {...current};
				delete next[nodeId];
				return next;
			});
			updateLadders(optimistic);
			setPending((current) => new Set(current).add(nodeId));
			let reconciling = false;
			try {
				const response = await fetch(path, {
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify(body),
				});
				if (!response.ok) {
					const failure = (await response.json()) as {error?: string; reconcile?: boolean};
					if (failure.reconcile) {
						reconciling = true;
						setRowErrors((current) => ({...current, [nodeId]: failure.error ?? 'Move failed'}));
						const refreshed = await fetch('/api/v1/ladder');
						if (!refreshed.ok) {
							setNeedsReload(true);
							setError('Could not refresh after the failed move. Reload before moving more rows.');
							return false;
						}
						const body = (await refreshed.json()) as {ladders: Ladders};
						updateLadders(() => body.ladders);
						return false;
					}
					throw new Error(failure.error ?? `write failed: ${response.status}`);
				}
				const {event} = (await response.json()) as {event: LadderEvent};
				if (receivedWrites.current.get(nodeId) === lastReceived) {
					updateLadders((current) => applyLadderEvent(current, event));
				}
				return true;
			} catch (cause) {
				if (reconciling) {
					setNeedsReload(true);
					setError('Could not refresh after the failed move. Reload before moving more rows.');
					return false;
				}
				// A received write is authoritative even if its HTTP response was lost.
				if (receivedWrites.current.get(nodeId) !== lastReceived) return true;
				updateLadders((current) => restoreRow(current, before, nodeId));
				setRowErrors((current) => ({
					...current,
					[nodeId]: cause instanceof Error ? cause.message : String(cause),
				}));
				return false;
			} finally {
				setPending((current) => {
					const next = new Set(current);
					next.delete(nodeId);
					return next;
				});
			}
		},
		[updateLadders],
	);

	const move = useCallback(
		(nodeId: string, toTier: string, beforeNodeId?: string) => {
			const ladder = laddersRef.current?.[root];
			if (busy.current || needsReload || !ladder) return;
			busy.current = true;
			setSaving(true);
			const ids = ladderMoveSelection(ladder, selected, nodeId);
			void (async () => {
				try {
					for (const id of ids) {
						const current = laddersRef.current;
						if (!current || (beforeNodeId === undefined && tierOf(current, root, id) === toTier)) continue;
						const saved = await write(
							'/api/v1/ladder/move',
							{
								root,
								node_id: id,
								to_tier: toTier,
								...(beforeNodeId === undefined ? {} : {before_id: beforeNodeId}),
							},
							(ladders) => moveWithin(ladders, root, id, toTier, beforeNodeId),
						);
						if (!saved) break;
					}
				} finally {
					busy.current = false;
					setSaving(false);
				}
			})();
		},
		[root, selected, write, needsReload],
	);

	const gesture = useRef<{nodeId: string; origin: Point; started: boolean; moving: Set<string>}>(undefined);
	const suppressClick = useRef(false);
	const [ghost, setGhost] = useState<{x: number; y: number; name: string}>();
	const page = useRef<HTMLDivElement>(null);
	const dragPoint = useRef<Point>(undefined);

	const cancelDrag = useCallback(() => {
		gesture.current = undefined;
		dragPoint.current = undefined;
		setGhost(undefined);
		setDragging(undefined);
		setDropTarget(undefined);
	}, []);

	useEffect(() => {
		if (!dragging) return;
		let frame: number;
		const scroll = () => {
			const at = dragPoint.current;
			const container = page.current;
			if (at && container && gesture.current) {
				const bounds = container.getBoundingClientRect();
				container.scrollBy(0, autoScrollBy(at.y - bounds.top, bounds.height));
				setDropTarget(dropAtPoint(at.x, at.y, gesture.current.moving));
			}
			frame = requestAnimationFrame(scroll);
		};
		frame = requestAnimationFrame(scroll);
		return () => cancelAnimationFrame(frame);
	}, [dragging]);

	const onGripDown = useCallback(
		(event: React.PointerEvent, item: {id: string; name: string}) => {
			if (busy.current || event.button !== 0 || !event.isPrimary) return;
			const target = event.target as HTMLElement;
			if (target.closest('button, a, input, select')) return;
			suppressClick.current = false;
			if (target.closest('.ladder-text')) {
				if (event.shiftKey) event.preventDefault();
				return;
			}
			// Touch scrolling remains available outside the grip.
			if (event.pointerType === 'touch' && !target.closest('.grip')) return;
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			const ladder = laddersRef.current?.[root];
			if (!ladder) return;
			gesture.current = {
				nodeId: item.id,
				origin: {x: event.clientX, y: event.clientY},
				started: false,
				moving: new Set(ladderMoveSelection(ladder, selected, item.id)),
			};
		},
		[root, selected],
	);

	const onGripMove = useCallback((event: React.PointerEvent, name: string) => {
		const active = gesture.current;
		if (!active) return;
		const at = {x: event.clientX, y: event.clientY};
		if (!active.started) {
			if (!isDragGesture(active.origin, at)) return;
			active.started = true;
			suppressClick.current = true;
			setDragging(active.nodeId);
		}
		dragPoint.current = at;
		setGhost({x: at.x, y: at.y, name: active.moving.size > 1 ? `${active.moving.size} selected rows` : name});
		setDropTarget(dropAtPoint(at.x, at.y, active.moving));
	}, []);

	const onGripUp = useCallback(
		(event: React.PointerEvent) => {
			const active = gesture.current;
			const target = active?.started ? dropAtPoint(event.clientX, event.clientY, active.moving) : undefined;
			cancelDrag();
			if (active?.started && target) move(active.nodeId, target.tier, target.beforeNodeId);
		},
		[move, cancelDrag],
	);

	const onRowClick = (event: React.MouseEvent, nodeId: string) => {
		if ((event.target as HTMLElement).closest('button, a, input, select')) return;
		if (suppressClick.current) {
			suppressClick.current = false;
			return;
		}
		if (
			!event.shiftKey &&
			(event.target as HTMLElement).closest('.ladder-text') &&
			globalThis.getSelection()?.isCollapsed === false
		)
			return;
		select(nodeId, event.shiftKey, event.metaKey || event.ctrlKey);
	};

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

	const select = (nodeId: string, range: boolean, additive = false) => {
		if (busy.current) return;
		const ladder = laddersRef.current?.[root];
		if (!ladder) return;
		if (range && anchor.current) {
			const rangeIds = selectLadderRange(ladder, anchor.current, nodeId);
			setSelected((current) => (additive ? new Set([...current, ...rangeIds]) : rangeIds));
		} else {
			anchor.current = nodeId;
			setSelected((current) => {
				const next = additive ? new Set(current) : new Set<string>();
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
	const [treeItem, setTreeItem] = useState<{id: string; name: string}>();

	return (
		<div
			className="ladder-page"
			data-dragging={dragging ? '' : undefined}
			ref={page}
		>
			<div className="ladder-wrap">
				<header className="ladder-head">
					<h1>Asap ladder</h1>
					<p className="ladder-dek">
						Drag a row to place it anywhere in a tier. Each tier holds 2<sup>k</sup>, fixed, so finishing
						work never pushes anything out of a tier above.
					</p>
					<p
						className="ladder-live"
						data-live={live ? 'on' : 'off'}
					>
						{live
							? 'Live — every write is broadcast as it lands'
							: 'Write stream disconnected — reload to reconnect'}
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
								dropping={dropTarget?.tier === tier.label}
								beforeNodeId={dropTarget?.tier === tier.label ? dropTarget.beforeNodeId : undefined}
								onRowClick={onRowClick}
								onGripCancel={cancelDrag}
								key={tier.id}
								nextTier={ladder.tiers[index + 1]?.label}
								onStep={move}
								previousTier={ladder.tiers[index - 1]?.label}
								onOpenTree={setTreeItem}
								onComplete={complete}
								onGripDown={onGripDown}
								onGripMove={onGripMove}
								onGripUp={onGripUp}
								pending={pending}
								rowErrors={rowErrors}
								selected={selected}
								onSelect={select}
								saving={saving || needsReload}
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
			{treeItem ? (
				<LadderTree
					key={treeItem.id}
					item={treeItem}
					onClose={() => setTreeItem(undefined)}
				/>
			) : null}
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
	beforeNodeId: string | undefined;
	onRowClick: (event: React.MouseEvent, nodeId: string) => void;
	onGripCancel: () => void;
	pending: Set<string>;
	rowErrors: Record<string, string>;
	selected: Set<string>;
	onSelect: (nodeId: string, range: boolean, additive?: boolean) => void;
	saving: boolean;
	/** Neighbouring tier labels, so the step buttons know where up and down are. */
	previousTier: string | undefined;
	nextTier: string | undefined;
	onOpenTree: (item: {id: string; name: string}) => void;
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
	beforeNodeId,
	onRowClick,
	onGripCancel,
	pending,
	rowErrors,
	selected,
	onSelect,
	saving,
	previousTier,
	nextTier,
	onComplete,
	onOpenTree,
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
				className={`ladder-zone ${tier.state}${dropping ? ' dropping' : ''}${beforeNodeId === '' ? ' drop-end' : ''}`}
				data-tier={tier.label}
			>
				{tier.items.map((item, index) => (
					<div
						className={[
							'ladder-row',
							selected.has(item.id) ? 'selected' : '',
							dragging === item.id || (dragging && selected.has(dragging) && selected.has(item.id))
								? 'dragging'
								: '',
							pending.has(item.id) ? 'pending' : '',
							index >= tier.capacity ? 'excess' : '',
							beforeNodeId === item.id ? 'drop-before' : '',
						]
							.filter(Boolean)
							.join(' ')}
						key={item.id}
						data-node-id={item.id}
						role="group"
						aria-label={`${item.name}${selected.has(item.id) ? ', selected' : ''}`}
						tabIndex={saving ? -1 : 0}
						onKeyDown={(event) => {
							if (event.target !== event.currentTarget || event.key !== ' ' || saving) return;
							event.preventDefault();
							onSelect(item.id, event.shiftKey, event.metaKey || event.ctrlKey);
						}}
						onClick={(event) => onRowClick(event, item.id)}
						onPointerCancel={onGripCancel}
						onLostPointerCapture={onGripCancel}
						onPointerDown={(event) => onGripDown(event, item)}
						onPointerMove={(event) => onGripMove(event, item.name)}
						onPointerUp={onGripUp}
					>
						<span
							className="grip"
							role="presentation"
						>
							&#10303;
						</span>
						<span className="rank">{index + 1}</span>
						<span className="txt">
							<span className="ladder-text">{item.name}</span>
							{item.descendantCount > 0 ? (
								<span
									className="ladder-child-count"
									aria-label={`${item.descendantCount} open ${item.descendantCount === 1 ? 'item' : 'items'} below`}
								>
									{item.descendantCount}
								</span>
							) : null}
							{item.hasChildren ? (
								<button
									className="ladder-tree-button"
									type="button"
									aria-label={`View tree for ${item.name}`}
									aria-haspopup="dialog"
									onClick={() => onOpenTree(item)}
								>
									Tree ▸
								</button>
							) : null}
							{item.children.length > 0 ? (
								<ul className="ladder-children">
									{item.children.map((child) => (
										<li key={child.id}>
											<span className="ladder-child-name">{child.name}</span>
											{child.descendantCount > 0 ? (
												<span className="ladder-child-more">+{child.descendantCount}</span>
											) : null}
										</li>
									))}
								</ul>
							) : null}
							{rowErrors[item.id] ? (
								<span
									className="ladder-row-error"
									role="alert"
								>
									{rowErrors[item.id]} — retry this row.
								</span>
							) : null}
						</span>
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
