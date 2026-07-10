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

function PaperPlaneIcon() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			className="h-5 w-5 fill-current transition ease-in-out motion-safe:group-hover:scale-110"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103zM2.25 8.184l3.897 1.67a.5.5 0 0 1 .262.263l1.67 3.897L12.743 3.52 2.25 8.184z" />
		</svg>
	);
}

function SpinnerIcon() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			className="h-5 w-5 animate-spin fill-current"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fillRule="evenodd"
				d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"
			/>
			<path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
		</svg>
	);
}

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
			<div className="rounded-lg border border-slate-200 bg-white/90 p-5 text-left shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-gray-700/90">
				<p className="text-xs text-slate-500 dark:text-slate-400">
					Your short link is ready
				</p>
				<p className="mt-1 break-all font-mono text-lg font-medium text-slate-900 dark:text-white">
					{display}
				</p>
				<div className="mt-4 flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={() => copy(state.link)}
						className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98]"
					>
						{state.copied ? "Copied" : "Copy link"}
					</button>
					<button
						type="button"
						onClick={reset}
						className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 active:scale-[0.98] dark:border-slate-600 dark:text-slate-200 dark:hover:bg-gray-600"
					>
						Shorten another
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
			<div className="relative">
				<input
					id="shorten-url"
					type="url"
					required
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder="https://verylongsite.com"
					className="block w-full rounded-lg border border-slate-300 bg-white/90 py-3 pr-14 pl-4 text-slate-900 shadow-sm backdrop-blur-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-gray-700/90 dark:text-white dark:placeholder:text-slate-400"
				/>
				<button
					type="submit"
					disabled={pending}
					aria-label="Shorten link"
					className="group absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg bg-slate-200 text-slate-700 transition hover:bg-slate-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-600 dark:text-slate-100 dark:hover:bg-gray-500"
				>
					{pending ? <SpinnerIcon /> : <PaperPlaneIcon />}
				</button>
			</div>
			{state.phase === "error" && (
				<p
					role="alert"
					className="mt-3 text-sm text-red-600 dark:text-red-400"
				>
					{state.message}
				</p>
			)}
		</form>
	);
}
