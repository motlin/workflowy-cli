import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import type {ReactNode, ReactPortal} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {ButtonMenuProps} from "../src/client/components/flyout/button-menu.js";

vi.mock(import("react-dom"), async (importOriginal) => ({
	...(await importOriginal()),
	createPortal: (node: ReactNode): ReactPortal => node as ReactPortal,
}));

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {ButtonMenu, focusSearchOnEscape} = await import("../src/client/components/flyout/button-menu.js");
const {useOutlineStore} = await import("../src/client/stores/outline.js");

function render(props: Omit<ButtonMenuProps, "children">): string {
	return renderToStaticMarkup(createElement(ButtonMenu, props, createElement("div", null, "crumbs")));
}

const button = createElement("span", null, "...");

const flyoutClass = `wf-menu flex flex-col
      border border-solid border-primary font-normal text-xs
      rounded-md bg-primary shadow-md
      overflow-x-hidden
      [transition:200ms_opacity]
      print:hidden flyout menu`;

const scrollerClass = `
          scroller overflow-y-auto
          desktop:max-h-[min(var(--menu-max-h),calc(100vh-50px))]
          mobile:max-h-[min(var(--menu-max-h),50vh)]
${" ".repeat(10)}
          [&amp;&gt;*:first-child]:mt-xs [&amp;&gt;*:last-child]:mb-xs
        `;

describe("ButtonMenu", () => {
	it("renders the breadcrumb configuration trigger and flyout exactly", () => {
		expect(render({button, actOnHover: true, expanded: true})).toBe(
			`<div tabindex="0" class="relative outline-none menu "><div><span>...</span></div>` +
				`<div class="${flyoutClass}" data-popper-reference-hidden="false" data-popper-escaped="false" data-popper-placement="bottom" style="position:absolute;inset:0px auto auto 0px;pointer-events:auto;z-index:1001;min-width:0;max-width:240px;margin-top:4px;padding:5px;transform:translate3d(0px, 0px, 0px)">` +
				`<div style="--menu-max-h:calc(100vh - 50px)" class="${scrollerClass}"><div>crumbs</div></div>` +
				`</div></div>`,
		);
	});

	it("renders no flyout when collapsed", () => {
		expect(render({button, actOnHover: true, expanded: false})).toBe(
			`<div tabindex="0" class="relative outline-none menu "><div><span>...</span></div></div>`,
		);
	});

	it("appends className and passes placement, sizes and style through", () => {
		const markup = render({
			button,
			className: "itemTypePickerMenu",
			expanded: true,
			placement: "bottom-start",
			minWidth: 100,
			maxWidth: 300,
			maxHeight: 700,
			offset: [-16, 2],
			style: {display: "flex"},
		});
		expect(markup.slice(0, markup.indexOf("<div><span>"))).toBe(
			`<div tabindex="0" style="display:flex" class="relative outline-none menu itemTypePickerMenu">`,
		);
		expect(markup).toContain(
			`data-popper-placement="bottom-start" style="position:absolute;inset:0px auto auto 0px;pointer-events:auto;z-index:1001;min-width:100px;max-width:300px;margin-top:6px;padding:5px;transform:translate3d(0px, 0px, 0px)"`,
		);
		expect(markup).toContain(`style="--menu-max-h:700px"`);
	});
});

describe("focusSearchOnEscape", () => {
	afterEach(() => {
		useOutlineStore.setState({searchPanelOpen: false});
	});

	it("opens the search panel when it is closed", () => {
		useOutlineStore.setState({searchPanelOpen: false});
		focusSearchOnEscape();
		expect(useOutlineStore.getState().searchPanelOpen).toBe(true);
	});

	it("leaves an open search panel open", () => {
		useOutlineStore.setState({searchPanelOpen: true});
		focusSearchOnEscape();
		expect(useOutlineStore.getState().searchPanelOpen).toBe(true);
	});
});
