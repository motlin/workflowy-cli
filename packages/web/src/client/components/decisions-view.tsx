/**
 * A decision page: a review agent stages questions under a slug, the user
 * answers each one here, and every change is saved as it happens. The page
 * only records choices; the agent reads the answers back and does the writes.
 */

import {useEffect, useRef, useState} from "react";
import {useParams} from "react-router-dom";
import type {DecisionItem, DecisionPage} from "../../server/decisions.js";
import "../decisions.css";
import {hideLoadingScreenOnce} from "../loading-screen.js";
import {readJson} from "../read-json.js";

const NOTE_DEBOUNCE_MS = 600;

type SaveStatus = {kind: "idle"} | {kind: "saving"} | {kind: "saved"} | {kind: "error"; message: string};

interface ItemState {
	choice: string | null;
	note: string;
	/** Whether the server holds an answer for this item. */
	answered: boolean;
	status: SaveStatus;
}

type SubmitState = {kind: "idle"} | {kind: "submitting"} | {kind: "submitted"} | {kind: "error"; message: string};

async function errorOf(response: Response): Promise<string> {
	const body = await readJson<{error: string}>(response);
	return body.error;
}

const STATUS_TEXT: Record<Exclude<SaveStatus["kind"], "error">, string> = {idle: "", saving: "Saving…", saved: "Saved"};

function statusText(status: SaveStatus): string {
	return status.kind === "error" ? `Not saved: ${status.message}` : STATUS_TEXT[status.kind];
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The staged page, or the reason it could not be loaded. */
async function loadPage(url: string, signal: AbortSignal): Promise<{page: DecisionPage} | {error: string}> {
	try {
		const response = await fetch(url, {signal});
		return response.ok ? {page: await readJson<DecisionPage>(response)} : {error: await errorOf(response)};
	} catch (error) {
		return {error: messageOf(error)};
	}
}

function initialItems(page: DecisionPage): Record<string, ItemState> {
	return Object.fromEntries(
		page.groups
			.flatMap((group) => group.items)
			.map((item) => [
				item.id,
				{
					choice: item.answer?.choice ?? null,
					note: item.answer?.note ?? "",
					answered: item.answer !== null,
					status: {kind: "idle"},
				},
			]),
	);
}

/** The `/decisions/:slug` route. */
export function DecisionsView() {
	const {slug = ""} = useParams();
	return <DecisionPageView key={slug} slug={slug} />;
}

export function DecisionPageView({slug}: {slug: string}) {
	const base = `/api/v1/decisions/${encodeURIComponent(slug)}`;
	const [page, setPage] = useState<DecisionPage | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [items, setItems] = useState<Record<string, ItemState>>({});
	const [submit, setSubmit] = useState<SubmitState>({kind: "idle"});
	// Mirrors `items` so a debounced save sends the choice and note current when it fires.
	const itemsRef = useRef<Record<string, ItemState>>({});
	const noteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

	// Only the outline view dismisses the boot screen; this route never mounts it.
	useEffect(() => {
		hideLoadingScreenOnce();
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		const timers = noteTimers.current;
		void (async () => {
			const result = await loadPage(base, controller.signal);
			if (controller.signal.aborted) {
				return;
			}
			if ("error" in result) {
				setLoadError(result.error);
				return;
			}
			itemsRef.current = initialItems(result.page);
			setItems(itemsRef.current);
			setPage(result.page);
			setSubmit(result.page.submittedAt === null ? {kind: "idle"} : {kind: "submitted"});
		})();
		return () => {
			controller.abort();
			for (const timer of timers.values()) {
				clearTimeout(timer);
			}
		};
	}, [base]);

	function update(id: string, patch: Partial<ItemState>): ItemState {
		const current = itemsRef.current[id];
		if (current === undefined) {
			throw new Error(`No decision item ${id}`);
		}
		const next = {...current, ...patch};
		itemsRef.current = {...itemsRef.current, [id]: next};
		setItems(itemsRef.current);
		return next;
	}

	async function save(id: string): Promise<void> {
		const {choice, note} = update(id, {status: {kind: "saving"}});
		try {
			const response = await fetch(`${base}/${encodeURIComponent(id)}`, {
				method: "PUT",
				headers: {"content-type": "application/json"},
				body: JSON.stringify({choice, note}),
			});
			if (!response.ok) {
				update(id, {status: {kind: "error", message: await errorOf(response)}});
				return;
			}
			update(id, {answered: true, status: {kind: "saved"}});
		} catch (error) {
			update(id, {status: {kind: "error", message: messageOf(error)}});
		}
	}

	function cancelNoteSave(id: string): void {
		clearTimeout(noteTimers.current.get(id));
		noteTimers.current.delete(id);
	}

	function choose(id: string, choice: string): void {
		cancelNoteSave(id);
		update(id, {choice});
		void save(id);
	}

	function editNote(id: string, note: string): void {
		cancelNoteSave(id);
		update(id, {note});
		noteTimers.current.set(
			id,
			setTimeout(() => {
				noteTimers.current.delete(id);
				void save(id);
			}, NOTE_DEBOUNCE_MS),
		);
	}

	async function submitPage(): Promise<void> {
		setSubmit({kind: "submitting"});
		try {
			const response = await fetch(`${base}/submit`, {method: "POST"});
			setSubmit(response.ok ? {kind: "submitted"} : {kind: "error", message: await errorOf(response)});
		} catch (error) {
			setSubmit({kind: "error", message: messageOf(error)});
		}
	}

	if (loadError !== null) {
		return (
			<main className="decisions-page">
				<p className="decisions-error" role="alert">
					{loadError}
				</p>
			</main>
		);
	}
	if (page === null) {
		return <main className="decisions-page" aria-busy="true" />;
	}

	const states = Object.values(items);
	const answered = states.filter((state) => state.answered).length;

	return (
		<main className="decisions-page">
			<div className="decisions-wrap">
				<header className="decisions-head">
					<h1>{page.title}</h1>
					{page.intro === undefined ? null : <p className="decisions-intro">{page.intro}</p>}
				</header>
				{page.groups.map((group) => (
					<section className="decisions-group" key={group.heading}>
						<h2 className="decisions-group-heading">
							{group.link === undefined ? (
								group.heading
							) : (
								<a href={group.link} rel="noopener noreferrer" target="_blank">
									{group.heading}
								</a>
							)}
						</h2>
						{group.items.map((item) => {
							// Every item gets its state in the same commit as the page, so this is never undefined.
							const state = items[item.id];
							return state === undefined ? null : (
								<DecisionCard
									item={item}
									key={item.id}
									onChoose={(choice) => {
										choose(item.id, choice);
									}}
									onNote={(note) => {
										editNote(item.id, note);
									}}
									state={state}
								/>
							);
						})}
					</section>
				))}
			</div>
			<footer className="decisions-footer">
				<span className="decisions-progress">
					{answered} of {states.length} answered
				</span>
				<span aria-live="polite" className="decisions-submit-state">
					{submit.kind === "submitted" ? (
						<span className="decisions-submitted">{"Submitted. Tell Claude you're done."}</span>
					) : null}
					{submit.kind === "error" ? <span className="decisions-submit-error">{submit.message}</span> : null}
				</span>
				<button
					className="decisions-submit"
					disabled={submit.kind === "submitting"}
					onClick={() => {
						void submitPage();
					}}
					type="button"
				>
					Submit
				</button>
			</footer>
		</main>
	);
}

interface DecisionCardProps {
	item: DecisionItem;
	state: ItemState;
	onChoose: (choice: string) => void;
	onNote: (note: string) => void;
}

function DecisionCard({item, state, onChoose, onNote}: DecisionCardProps) {
	const noteId = `decision-note-${item.id}`;
	return (
		<fieldset className="decisions-card" data-item-id={item.id} data-status={state.status.kind}>
			<legend>
				<h3>{item.title}</h3>
			</legend>
			{item.body.length > 0 ? (
				<div className="decisions-body">
					{item.body.map((line, index) => (
						// Body lines are plain text that may repeat, so their position is their identity.
						// oxlint-disable-next-line react/no-array-index-key
						<p className="decisions-body-line" key={index}>
							{line}
						</p>
					))}
				</div>
			) : null}
			{item.links.length > 0 ? (
				<ul className="decisions-links">
					{item.links.map((link) => (
						<li key={link.href}>
							<a href={link.href} rel="noopener noreferrer" target="_blank">
								{link.label}
							</a>
						</li>
					))}
				</ul>
			) : null}
			<div className="decisions-options">
				{item.options.map((option) => (
					<label className="decisions-option" key={option.value}>
						<input
							checked={state.choice === option.value}
							name={`decision-${item.id}`}
							onChange={() => {
								onChoose(option.value);
							}}
							type="radio"
							value={option.value}
						/>
						<span className="decisions-option-text">
							<span className="decisions-option-label">{option.label}</span>
							{item.default === option.value ? (
								<span className="decisions-suggested">suggested</span>
							) : null}
							{option.description === undefined ? null : (
								<span className="decisions-option-description">{option.description}</span>
							)}
						</span>
					</label>
				))}
			</div>
			<label className="decisions-note-label" htmlFor={noteId}>
				Other / note
			</label>
			<textarea
				className="decisions-note"
				id={noteId}
				onChange={(event) => {
					onNote(event.target.value);
				}}
				rows={2}
				value={state.note}
			/>
			<span aria-live="polite" className="decisions-status">
				{statusText(state.status)}
			</span>
		</fieldset>
	);
}
