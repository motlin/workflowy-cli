import {Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useState} from "react";
import type {CSSProperties, ReactElement, ReactNode} from "react";
import type {MenuItemProps} from "./menu-item.js";
import {menuKeyboard} from "./menu-keyboard.js";
import type {MenuKeyboardState} from "./menu-keyboard.js";

type MenuItemElement = ReactElement<MenuItemProps>;

function isMenuItem(node: ReactNode): node is MenuItemElement {
	if (!isValidElement(node) || typeof node.type === "string") {
		return false;
	}
	return "componentType" in node.type && node.type.componentType === "menuItem";
}

function isBottomSticky(node: ReactNode): node is MenuItemElement {
	return isMenuItem(node) && node.props.bottomSticky === true;
}

/** Runs an item's onSelect; upstream keeps the menu open only when it returns a truthy value. */
function keepsOpen(onSelect: (() => unknown) | undefined): boolean {
	return Boolean(onSelect?.());
}

/** Upstream `--menu-max-h`: `<n>px` for a number, a px string as-is, otherwise the viewport cap. */
export function menuMaxHeight(maxHeight: number | string | undefined): string {
	if (maxHeight === undefined || maxHeight === "" || maxHeight === 0) {
		return "calc(100vh - 50px)";
	}
	if (typeof maxHeight === "number") {
		return `${maxHeight}px`;
	}
	return maxHeight.endsWith("px") ? maxHeight : "calc(100vh - 50px)";
}

export interface MenuBodyProps {
	/** Upstream `__unstable_unwrapped`: ButtonMenu supplies the surface, so MenuBody renders only the scroller. */
	unwrapped?: true;
	maxHeight?: number | string;
	exit?: () => void;
	disableKeyboard?: boolean;
	cyclicNavigation?: boolean;
	selectOnTab?: boolean;
	stopKeydownEventPropagation?: boolean;
	keyboardMode?: boolean;
	initialSelect?: number;
	children?: ReactNode;
}

/** Upstream DomKit Menu (`z24`) in its unwrapped form: keyboard model, item cloning, scroller and bottomSticky. */
export function MenuBody({
	maxHeight,
	exit,
	disableKeyboard = false,
	cyclicNavigation = false,
	selectOnTab = true,
	stopKeydownEventPropagation = false,
	keyboardMode = false,
	initialSelect = -1,
	children,
}: MenuBodyProps) {
	const [state, setState] = useState<MenuKeyboardState>({index: initialSelect, hidden: false, keyboardMode});
	const [lastKeyMoved, setLastKeyMoved] = useState(false);
	const [mouseMovedSinceKey, setMouseMovedSinceKey] = useState(false);
	const [previous, setPrevious] = useState({children, initialSelect});

	// Upstream resets the selection whenever children or initialSelect change, unless the last key moved it.
	if (previous.children !== children || previous.initialSelect !== initialSelect) {
		setPrevious({children, initialSelect});
		if (!lastKeyMoved) {
			setState({...state, index: initialSelect, hidden: false});
			setMouseMovedSinceKey(false);
		}
	}

	const navigable = useMemo(
		() =>
			Children.toArray(children).filter(
				(child): child is MenuItemElement => isMenuItem(child) && child.props.disabled !== true,
			),
		[children],
	);

	const selectIndex = useCallback(
		(index: number) => {
			if (!keepsOpen(navigable[index]?.props.onSelect)) {
				exit?.();
			}
		},
		[navigable, exit],
	);

	const stopWhenSelected = !state.hidden && state.index !== -1 && stopKeydownEventPropagation;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const result = menuKeyboard(
				state,
				{key: event.key, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, composing: event.isComposing},
				{
					count: navigable.length,
					cyclic: cyclicNavigation,
					selectOnTab,
					stopPropagation: stopKeydownEventPropagation,
				},
			);
			if (result.preventDefault) {
				event.preventDefault();
			}
			if (result.stopImmediate) {
				event.stopImmediatePropagation();
			}
			setLastKeyMoved(result.action === "move" && !event.ctrlKey);
			if (result.action === "move") {
				setMouseMovedSinceKey(false);
				setState(result.state);
			} else if (result.action === "select") {
				selectIndex(state.index);
			}
		};
		if (!disableKeyboard) {
			window.addEventListener("keydown", onKeyDown, stopWhenSelected);
		}
		return () => {
			window.removeEventListener("keydown", onKeyDown, stopWhenSelected);
		};
	}, [
		disableKeyboard,
		state,
		navigable,
		cyclicNavigation,
		selectOnTab,
		stopKeydownEventPropagation,
		stopWhenSelected,
		selectIndex,
	]);

	let navigableIndex = 0;
	const cloneItem = (child: ReactNode): ReactNode => {
		if (!isMenuItem(child)) {
			return child;
		}
		const index = navigableIndex;
		const enabled = child.props.disabled !== true;
		if (enabled) {
			navigableIndex++;
		}
		return cloneElement(child, {
			isSelected: state.keyboardMode && enabled && state.index === index,
			isInKeyboardMode: state.keyboardMode,
			bottomSticky: isBottomSticky(child),
			onMouseEnter: () => {
				if (mouseMovedSinceKey) {
					setState((current) => ({...current, index, keyboardMode: false}));
				}
			},
			onSelect: () => {
				if (!keepsOpen(child.props.onSelect)) {
					exit?.();
				}
			},
		});
	};

	const sticky: MenuItemElement[] = [];
	const body = Children.map(children, (child): ReactNode => {
		if (isBottomSticky(child)) {
			sticky.push(child);
			return null;
		}
		return cloneItem(child);
	});
	const scrollerStyle: CSSProperties & Record<"--menu-max-h", string> = {"--menu-max-h": menuMaxHeight(maxHeight)};

	return (
		<>
			<div
				onMouseMove={() => {
					setMouseMovedSinceKey(true);
				}}
				style={scrollerStyle}
				className={`
          scroller overflow-y-auto
          desktop:max-h-[min(var(--menu-max-h),calc(100vh-50px))]
          mobile:max-h-[min(var(--menu-max-h),50vh)]
          ${sticky.length > 0 ? "border-b border-primary" : ""}
          [&>*:first-child]:mt-xs [&>*:last-child]:mb-xs
        `}
			>
				{body}
			</div>
			{sticky.map(cloneItem)}
		</>
	);
}
