import {create} from "zustand";
import {z} from "zod";

/** Upstream's browser-local record of which left-bar rows are open, per section context. */
const LEFT_BAR_EXPANSIONS_STORAGE_KEY = "stateStorage::leftBarExpansions";

export type LeftBarExpansions = Record<string, string[]>;

/** Flip `id` open or closed within `contextKey`, leaving other contexts untouched. */
export function toggleExpansion(map: LeftBarExpansions, contextKey: string, id: string): LeftBarExpansions {
	const ids = map[contextKey] ?? [];
	return {...map, [contextKey]: ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]};
}

function readExpansions(): LeftBarExpansions {
	try {
		const raw = localStorage.getItem(LEFT_BAR_EXPANSIONS_STORAGE_KEY);
		const result = z.record(z.string(), z.array(z.string())).safeParse(raw === null ? {} : JSON.parse(raw));
		return result.success ? result.data : {};
	} catch {
		return {};
	}
}

interface LeftBarExpansionStore {
	expansions: LeftBarExpansions;
	toggle: (contextKey: string, id: string) => void;
}

export const useLeftBarExpansionStore = create<LeftBarExpansionStore>((set, get) => ({
	expansions: readExpansions(),
	toggle: (contextKey, id) => {
		const expansions = toggleExpansion(get().expansions, contextKey, id);
		set({expansions});
		try {
			localStorage.setItem(LEFT_BAR_EXPANSIONS_STORAGE_KEY, JSON.stringify(expansions));
		} catch {
			// Storage can be unavailable (private mode, blocked site data); state stays in memory.
		}
	},
}));
