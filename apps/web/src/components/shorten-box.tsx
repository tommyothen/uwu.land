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
			<div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
				<p className="text-sm text-zinc-500 dark:text-zinc-400">
					Your short link is ready
				</p>
				<p className="mt-2 break-all font-mono text-xl font-medium text-zinc-900 dark:text-zinc-50">
					{display}
				</p>
				<p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
					{state.link.url}
				</p>
				<div className="mt-5 flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={() => copy(state.link)}
						className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600 active:scale-[0.98]"
					>
						{state.copied ? "Copied" : "Copy link"}
					</button>
					<button
						type="button"
						onClick={reset}
						className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
					>
						Shorten another
					</button>
				</div>
			</div>
		);
	}

	const pending = state.phase === "pending";
	return (
		<form
			onSubmit={submit}
			className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
		>
			<label
				htmlFor="shorten-url"
				className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
			>
				URL to shorten
			</label>
			<div className="mt-2 flex flex-col gap-3 sm:flex-row">
				<input
					id="shorten-url"
					type="url"
					required
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder="https://example.com/a/very/long/link"
					className="w-full flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder-zinc-500"
				/>
				<button
					type="submit"
					disabled={pending}
					className="rounded-lg bg-rose-700 px-5 py-2 text-sm font-medium text-white transition hover:bg-rose-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{pending ? "Shortening…" : "Shorten"}
				</button>
			</div>
			<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
				No account needed. Random slug, permanent link.
			</p>
			{state.phase === "error" && (
				<p
					role="alert"
					className="mt-3 text-sm text-rose-700 dark:text-rose-400"
				>
					{state.message}
				</p>
			)}
		</form>
	);
}
