/** Upstream keys its theme rules off a body class; mirror it so verbatim `._theme-*` selectors apply. */
export function themeBodyClass(effective: "light" | "dark"): "_theme-default" | "_theme-dark" {
	return effective === "dark" ? "_theme-dark" : "_theme-default";
}
