"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { getTheme, setTheme, type Theme } from "@/lib/theme";

/** Sun/moon toggle wired to theme.ts (spec §9, §11). */
export function ThemeToggle() {
	const [theme, setThemeState] = useState<Theme>("light");

	useEffect(() => {
		setThemeState(getTheme());
	}, []);

	function toggle() {
		const next: Theme = theme === "dark" ? "light" : "dark";
		setThemeState(next);
		setTheme(next);
	}

	return (
		<button
			type="button"
			onClick={toggle}
			aria-label="Toggle dark mode"
			className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-border text-foreground transition hover:bg-secondary"
		>
			{theme === "dark" ? (
				<Sun className="h-4 w-4" aria-hidden="true" />
			) : (
				<Moon className="h-4 w-4" aria-hidden="true" />
			)}
		</button>
	);
}
