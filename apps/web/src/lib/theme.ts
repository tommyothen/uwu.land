export type Theme = "light" | "dark";

const STORAGE_KEY = "uwu-theme";

export function resolveTheme(stored: Theme | null, systemDark: boolean): Theme {
	return stored ?? (systemDark ? "dark" : "light");
}

export function getTheme(): Theme {
	const stored = localStorage.getItem(STORAGE_KEY);
	const preference = stored === "dark" || stored === "light" ? stored : null;
	return resolveTheme(
		preference,
		window.matchMedia("(prefers-color-scheme: dark)").matches
	);
}

export function applyTheme(theme = getTheme()): Theme {
	document.documentElement.classList.toggle("dark", theme === "dark");
	return theme;
}

export function setTheme(theme: Theme): Theme {
	localStorage.setItem(STORAGE_KEY, theme);
	return applyTheme(theme);
}
