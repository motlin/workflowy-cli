import {describe, expect, it, vi} from "vite-plus/test";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {bulletClickAction, nodeUrl, planZoomFocus} = await import("../src/client/navigation.js");

const ZOOMED = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";
const PARENT = "44444444-4444-4444-8444-444444444444";

const base = {
	zoomedId: ZOOMED,
	targetId: TARGET,
	firstChildId: null,
	parentOfZoomed: PARENT,
	previousEditingId: null,
	previousOffset: 0,
};

describe("planZoomFocus first_child", () => {
	it("edits the first visible child at offset 0 and scrolls to the top", () => {
		expect(planZoomFocus("first_child", {...base, firstChildId: CHILD})).toStrictEqual({
			route: nodeUrl(TARGET),
			editId: CHILD,
			offset: 0,
			scrollTop: true,
		});
	});

	it("edits the zoom title of a leaf at offset 0", () => {
		expect(planZoomFocus("first_child", base)).toStrictEqual({
			route: nodeUrl(TARGET),
			editId: TARGET,
			offset: 0,
			scrollTop: true,
		});
	});

	it("keeps the old caret offset when the planned row is the row that had focus", () => {
		expect(planZoomFocus("first_child", {...base, previousEditingId: TARGET, previousOffset: 3})).toStrictEqual({
			route: nodeUrl(TARGET),
			editId: TARGET,
			offset: 3,
			scrollTop: true,
		});
	});

	it("resets the offset when the planned row differs from the row that had focus", () => {
		expect(
			planZoomFocus("first_child", {...base, firstChildId: CHILD, previousEditingId: TARGET, previousOffset: 3}),
		).toStrictEqual({route: nodeUrl(TARGET), editId: CHILD, offset: 0, scrollTop: true});
	});

	it("does nothing when the target is already zoomed", () => {
		expect(planZoomFocus("first_child", {...base, targetId: ZOOMED, firstChildId: CHILD})).toBeNull();
	});

	it("edits nothing when zooming home with no children", () => {
		expect(planZoomFocus("first_child", {...base, targetId: null})).toStrictEqual({
			route: "/",
			editId: null,
			offset: 0,
			scrollTop: true,
		});
	});
});

describe("planZoomFocus last_selected", () => {
	it("zooms out to the parent and edits the node zoomed out of at offset 0 without scrolling", () => {
		expect({
			parent: planZoomFocus("last_selected", {...base, previousEditingId: ZOOMED, previousOffset: 4}),
			home: planZoomFocus("last_selected", {...base, parentOfZoomed: null}),
		}).toStrictEqual({
			parent: {route: nodeUrl(PARENT), editId: ZOOMED, offset: 0, scrollTop: false},
			home: {route: "/", editId: ZOOMED, offset: 0, scrollTop: false},
		});
	});

	it("does nothing at the root", () => {
		expect(planZoomFocus("last_selected", {...base, zoomedId: null, parentOfZoomed: null})).toBeNull();
	});
});

describe("bulletClickAction", () => {
	const plain = {metaKey: false, ctrlKey: false, button: 0};

	it("zooms on a plain left click", () => {
		expect(bulletClickAction(plain)).toBe("zoom");
	});

	it("leaves a meta click to the browser", () => {
		expect(bulletClickAction({...plain, metaKey: true})).toBe("browser");
	});

	it("leaves a ctrl click to the browser", () => {
		expect(bulletClickAction({...plain, ctrlKey: true})).toBe("browser");
	});

	it("leaves a middle click to the browser", () => {
		expect(bulletClickAction({...plain, button: 1})).toBe("browser");
	});
});
