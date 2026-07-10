"use client";

import type { CreateLinkResponse } from "@uwu/shared";
import { type FormEvent, useState } from "react";
import { createLink } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

type State =
	| { phase: "idle" }
	| { phase: "pending" }
	| { phase: "success"; link: CreateLinkResponse; copied: boolean }
	| { phase: "error"; message: string };

export function ShortenBox() {
	const [state, setState] = useState<State>({ phase: "idle" });
	const [url, setUrl] = useState("");

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (state.phase === "pending" || url.trim() === "") {
			return;
		}
		setState({ phase: "pending" });
		try {
			const link = await createLink({ url: url.trim() }, null);
			setState({ phase: "success", link, copied: false });
		} catch (error) {
			setState({ phase: "error", message: friendlyError(error) });
		}
	}

	async function copy(link: CreateLinkResponse) {
		await navigator.clipboard.writeText(link.short_url);
		setState({ phase: "success", link, copied: true });
	}

	function reset() {
		setUrl("");
		setState({ phase: "idle" });
	}

	if (state.phase === "success") {
		const display = state.link.short_url.replace(/^https?:\/\//, "");
		return (
			<div className="rounded-[14px] border-2 border-foreground bg-card p-5 text-left shadow-[5px_5px_0_var(--shadow-ink)]">
				<p className="text-sm text-muted-foreground">
					Delivered. Your link now fits anywhere.
				</p>
				<p className="mt-1.5 font-mono text-xl font-bold break-all text-card-foreground">
					{display}
				</p>
				<div className="mt-4 flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={() => copy(state.link)}
						className="press rounded-[10px] bg-primary px-4 py-2 font-mono text-sm font-bold text-primary-foreground uppercase shadow-[3px_3px_0_var(--shadow-ink)]"
					>
						{state.copied ? "copied!" : "tear + copy"}
					</button>
					<button
						type="button"
						onClick={reset}
						className="rounded-[10px] border-2 border-foreground px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary"
					>
						Send another
					</button>
				</div>
			</div>
		);
	}

	const pending = state.phase === "pending";
	return (
		<form onSubmit={submit}>
			<label htmlFor="shorten-url" className="sr-only">
				URL to shorten
			</label>
			<div className="flex items-stretch gap-1.5 rounded-[14px] border-2 border-foreground bg-card p-1.5 shadow-[5px_5px_0_var(--shadow-ink)] focus-within:border-ring">
				<input
					id="shorten-url"
					type="url"
					required
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder="https://verylongsite.com/a/really/long/path"
					className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-card-foreground outline-none placeholder:text-[color:var(--placeholder,#837ba6)]"
				/>
				<button
					type="submit"
					disabled={pending}
					className="press shrink-0 rounded-[10px] bg-primary px-5 py-2.5 text-[15px] font-semibold text-primary-foreground shadow-[3px_3px_0_var(--shadow-ink)] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{pending ? "in transit…" : "Send it"}
				</button>
			</div>
			{state.phase === "error" && (
				<p
					role="alert"
					className="mt-3 text-sm font-medium text-destructive"
				>
					{state.message}
				</p>
			)}
		</form>
	);
}
