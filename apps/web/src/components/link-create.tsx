"use client";

import { useAuth } from "@clerk/nextjs";
import type { CreateLinkResponse } from "@uwu/shared";
import { type FormEvent, useState } from "react";
import { createLink } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

export function LinkCreate({
	onCreated
}: {
	onCreated: (link: CreateLinkResponse) => void;
}) {
	const { getToken } = useAuth();
	const [url, setUrl] = useState("");
	const [slug, setSlug] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<CreateLinkResponse | null>(null);
	const [copied, setCopied] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending || url.trim() === "") {
			return;
		}
		setPending(true);
		setError(null);
		setCreated(null);
		try {
			const token = await getToken();
			if (token === null) {
				return;
			}
			const trimmedSlug = slug.trim();
			const link = await createLink(
				trimmedSlug === ""
					? { url: url.trim() }
					: { url: url.trim(), slug: trimmedSlug },
				token
			);
			setCreated(link);
			setCopied(false);
			setUrl("");
			setSlug("");
			onCreated(link);
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setPending(false);
		}
	}

	async function copy(link: CreateLinkResponse) {
		await navigator.clipboard.writeText(link.short_url);
		setCopied(true);
	}

	return (
		<form
			onSubmit={submit}
			className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
		>
			<div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
				<div>
					<label
						htmlFor="create-url"
						className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
					>
						URL
					</label>
					<input
						id="create-url"
						type="url"
						required
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder="https://example.com/long/link"
						className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder-zinc-500"
					/>
				</div>
				<div>
					<label
						htmlFor="create-slug"
						className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
					>
						Custom slug
					</label>
					<input
						id="create-slug"
						type="text"
						value={slug}
						onChange={(event) => setSlug(event.target.value)}
						placeholder="optional"
						className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder-zinc-500"
					/>
				</div>
				<button
					type="submit"
					disabled={pending}
					className="rounded-lg bg-rose-700 px-5 py-2 text-sm font-medium text-white transition hover:bg-rose-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{pending ? "Creating…" : "Create"}
				</button>
			</div>
			<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
				Slugs are 3 to 16 characters: letters, numbers, underscores, hyphens.
			</p>
			{error !== null && (
				<p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-400">
					{error}
				</p>
			)}
			{created !== null && (
				<p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
					<span className="text-zinc-500 dark:text-zinc-400">Created</span>
					<span className="font-mono font-medium">
						{created.short_url.replace(/^https?:\/\//, "")}
					</span>
					<button
						type="button"
						onClick={() => copy(created)}
						className="text-xs font-medium text-rose-700 transition hover:text-rose-600 dark:text-rose-400"
					>
						{copied ? "Copied" : "Copy"}
					</button>
				</p>
			)}
		</form>
	);
}
