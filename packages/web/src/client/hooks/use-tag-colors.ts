import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {readJson} from "../read-json.js";
import {normalizeTagColors} from "../tag-color-styles.js";

/**
 * Per-tag color assignments, as a map of the lowercased tag text (incl. leading
 * #/@) to a Workflowy color name. These are Workflowy's own colors, stored in
 * root metadata `color.tags` and shared with workflowy.com, via /api/v1/tags.
 * Keys are lowercased on read, so look tags up with `tag.toLowerCase()`.
 */
export type TagColors = Record<string, string>;

const tagColorKeys = {
	all: ["tag-colors"] as const,
};

async function fetchTagColors(): Promise<TagColors> {
	const response = await fetch("/api/v1/tags");
	if (!response.ok) {
		throw new Error(`Failed to fetch tag colors: ${response.statusText}`);
	}
	const data = await readJson<{colors: TagColors}>(response);
	return normalizeTagColors(data.colors);
}

async function setTagColor(name: string, color: string): Promise<void> {
	const response = await fetch(`/api/v1/tags/${encodeURIComponent(name)}`, {
		method: "PUT",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({color}),
	});
	if (!response.ok) {
		throw new Error(`Failed to set tag color: ${response.statusText}`);
	}
}

async function removeTagColor(name: string): Promise<void> {
	const response = await fetch(`/api/v1/tags/${encodeURIComponent(name)}`, {
		method: "DELETE",
	});
	if (!response.ok) {
		throw new Error(`Failed to remove tag color: ${response.statusText}`);
	}
}

/**
 * Returns the map of tag colors. Defaults to an empty map while loading so
 * callers can read it unconditionally.
 */
export function useTagColors(): TagColors {
	const {data} = useQuery({
		queryKey: tagColorKeys.all,
		queryFn: fetchTagColors,
	});
	return data ?? {};
}

export function useSetTagColor() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({name, color}: {name: string; color: string}) => setTagColor(name, color),
		async onSettled() {
			await queryClient.invalidateQueries({queryKey: tagColorKeys.all});
		},
	});
}

export function useRemoveTagColor() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (name: string) => removeTagColor(name),
		async onSettled() {
			await queryClient.invalidateQueries({queryKey: tagColorKeys.all});
		},
	});
}
