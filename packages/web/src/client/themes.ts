/** Upstream's theme registry (`WF.map.GuiThemes`); the order is the dropdown order. */

export interface ThemeInfo {
	readonly name: string;
	readonly prettyName: string;
	/** Metadata only, as upstream: nothing but the ladder palette reads it. */
	readonly dark?: boolean;
}

export const THEMES: readonly ThemeInfo[] = [
	{name: "default", prettyName: "Light"},
	{name: "dark", prettyName: "Dark", dark: true},
	{name: "system", prettyName: "System"},
	{name: "vintage", prettyName: "Vintage"},
	{name: "catppuccin", prettyName: "Catppuccin", dark: true},
	{name: "chocolate", prettyName: "Chocolate"},
	{name: "glass", prettyName: "Glass"},
	{name: "hacker", prettyName: "Hacker", dark: true},
	{name: "matcha", prettyName: "Matcha"},
	{name: "moon", prettyName: "Moon"},
	{name: "neo", prettyName: "Neo", dark: true},
	{name: "robot", prettyName: "Robot", dark: true},
	{name: "space", prettyName: "Space", dark: true},
	{name: "steel", prettyName: "Steel"},
	{name: "wood", prettyName: "Wood"},
	{name: "one_dark", prettyName: "One Dark", dark: true},
];

export type ThemeName = string;

const DEFAULT_THEME: ThemeName = "default";

/** The selected theme if registered, else the first (`default`). */
export function currentTheme(selected: string | null | undefined): ThemeName {
	return THEMES.find((theme) => theme.name === selected)?.name ?? DEFAULT_THEME;
}

/** The sheet to apply: `system` resolves from the OS colour scheme. */
export function effectiveTheme(selected: string | null | undefined, prefersDark: boolean): ThemeName {
	const current = currentTheme(selected);
	if (current === "system") {
		return prefersDark ? "dark" : "default";
	}
	return current;
}

export function isDarkTheme(name: string): boolean {
	return THEMES.find((theme) => theme.name === name)?.dark === true;
}

export function isRegisteredTheme(name: string | null | undefined): name is ThemeName {
	return THEMES.some((theme) => theme.name === name);
}
