import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {selectIsMutating, useOutlineStore} = await import("../src/client/stores/outline.js");

function mutationState() {
	const state = useOutlineStore.getState();
	return {mutationCount: state.mutationCount, isMutating: selectIsMutating(state)};
}

describe("the saving overlay counts in-flight mutations", () => {
	beforeEach(() => {
		useOutlineStore.setState({mutationCount: 0});
	});

	it("stays up until every overlapping mutation has settled", () => {
		const {beginMutation, endMutation} = useOutlineStore.getState();
		beginMutation();
		beginMutation();
		endMutation();
		const oneLeft = mutationState();
		endMutation();
		const allSettled = mutationState();
		expect({oneLeft, allSettled}).toStrictEqual({
			oneLeft: {mutationCount: 1, isMutating: true},
			allSettled: {mutationCount: 0, isMutating: false},
		});
	});

	it("never counts below zero on an extra end", () => {
		useOutlineStore.getState().endMutation();
		expect(mutationState()).toStrictEqual({mutationCount: 0, isMutating: false});
	});
});
