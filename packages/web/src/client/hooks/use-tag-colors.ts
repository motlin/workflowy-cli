import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

/**
 * Per-tag color assignments, as a map of tag text (incl. leading #/@) to a
 * Workflowy color name. Backed by the local `tags` table via /api/v1/tags.
 * Workflowy itself has no API for tag colors — this is our own feature.
 */
export type TagColors = Record<string, string>;

const tagColorKeys = {
	all: ['tag-colors'] as const,
};

async function fetchTagColors(): Promise<TagColors> {
	const response = await fetch('/api/v1/tags');
	if (!response.ok) {
		throw new Error(`Failed to fetch tag colors: ${response.statusText}`);
	}
	const data = (await response.json()) as {colors: TagColors};
	return data.colors;
}

async function setTagColor(name: string, color: string): Promise<void> {
	const response = await fetch(`/api/v1/tags/${encodeURIComponent(name)}`, {
		method: 'PUT',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({color}),
	});
	if (!response.ok) {
		throw new Error(`Failed to set tag color: ${response.statusText}`);
	}
}

async function removeTagColor(name: string): Promise<void> {
	const response = await fetch(`/api/v1/tags/${encodeURIComponent(name)}`, {
		method: 'DELETE',
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
		mutationFn: ({name, color}: {name: string; color: string}) => setTagColor(name, color),
		async onSettled() {
			await queryClient.invalidateQueries({queryKey: tagColorKeys.all});
		},
	});
}

export function useRemoveTagColor() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => removeTagColor(name),
		async onSettled() {
			await queryClient.invalidateQueries({queryKey: tagColorKeys.all});
		},
	});
}
