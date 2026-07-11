"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { getTheme, setTheme, type Theme } from "@/lib/theme";

/**
 * Sun/moon toggle wired to theme.ts (spec §9, §11).
 *
 * `variant="chrome"` (default) is the bordered icon button used in the app
 * chrome (site header, dashboard). `variant="bare"` is a borderless, ink-tinted
 * icon that sits inline with the landing nav's small text links.
 */
export function ThemeToggle({
	variant = "chrome"
}: {
	variant?: "chrome" | "bare";
}) {
	const [theme, setThemeState] = useState<Theme>("light");

	useEffect(() => {
		try {
			setThemeState(getTheme());
		} catch {
			// No localStorage/matchMedia (e.g. hardened envs): keep the default.
		}
	}, []);

	function toggle() {
		const next: Theme = theme === "dark" ? "light" : "dark";
		setThemeState(next);
		setTheme(next);
	}

	const className =
		variant === "bare"
			? "inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-foreground/75 transition hover:bg-foreground/[0.06] hover:text-foreground"
			: "inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-border text-foreground transition hover:bg-secondary";
	const iconSize = variant === "bare" ? "h-[18px] w-[18px]" : "h-4 w-4";

	return (
		<button
			type="button"
			onClick={toggle}
			aria-label="Toggle dark mode"
			className={className}
		>
			{theme === "dark" ? (
				<Sun className={iconSize} aria-hidden="true" />
			) : (
				<Moon className={iconSize} aria-hidden="true" />
			)}
		</button>
	);
}
