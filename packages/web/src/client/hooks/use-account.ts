import {useQuery} from "@tanstack/react-query";
import type {MentionAccount} from "../mention-pills.js";
import {readJson} from "../read-json.js";

interface AccountResponse {
	userId: number;
	joinedAt: string;
	fullName: string | null;
}

export const accountKeys = {all: ["account"] as const};

/** The signed-in account's id and full name, which resolve stored `<mention>` ids to names; null until loaded or unavailable. */
export function useAccount(): MentionAccount {
	const {data} = useQuery({
		queryKey: accountKeys.all,
		staleTime: Infinity,
		retry: false,
		queryFn: async (): Promise<MentionAccount> => {
			const response = await fetch("/api/v1/account");
			if (!response.ok) {
				return null;
			}
			const {userId, fullName, joinedAt} = await readJson<AccountResponse>(response);
			return {userId, fullName, joinedAt};
		},
	});
	return data ?? null;
}
