"use client";

import { useAuth } from "@clerk/nextjs";
import type { LinkSummary } from "@uwu/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteLink, listLinks } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

export function LinkTable({ prepend }: { prepend?: LinkSummary }) {
	const { getToken } = useAuth();
	const [links, setLinks] = useState<LinkSummary[] | null>(null);
	const [cursor, setCursor] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
	const seenPrepend = useRef<LinkSummary | undefined>(undefined);
	const loadedInitial = useRef(false);

	useEffect(() => {
		if (loadedInitial.current) {
			return;
		}
		loadedInitial.current = true;
		let cancelled = false;
		(async () => {
			const token = await getToken();
			if (token === null) {
				return;
			}
			try {
				const page = await listLinks(token, undefined);
				if (!cancelled) {
					setLinks(page.links);
					setCursor(page.cursor);
				}
			} catch (err) {
				if (!cancelled) {
					setError(friendlyError(err));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [getToken]);

	useEffect(() => {
		if (prepend !== undefined && prepend !== seenPrepend.current) {
			seenPrepend.current = prepend;
			setLinks((current) =>
				current === null
					? [prepend]
					: [prepend, ...current.filter((l) => l.slug !== prepend.slug)]
			);
		}
	}, [prepend]);

	const loadMore = useCallback(async () => {
		if (cursor === undefined || busy) {
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const token = await getToken();
			if (token === null) {
				return;
			}
			const page = await listLinks(token, cursor);
			setLinks((current) => [...(current ?? []), ...page.links]);
			setCursor(page.cursor);
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setBusy(false);
		}
	}, [cursor, busy, getToken]);

	async function confirmDelete(slug: string) {
		setConfirming(null);
		const previous = links;
		setLinks((current) => current?.filter((l) => l.slug !== slug) ?? null);
		try {
			const token = await getToken();
			if (token === null) {
				return;
			}
			await deleteLink(slug, token);
		} catch (err) {
			setLinks(previous);
			setError(friendlyError(err));
		}
	}

	async function copyShortUrl(link: LinkSummary) {
		await navigator.clipboard.writeText(link.short_url);
		setCopiedSlug(link.slug);
		setTimeout(() => setCopiedSlug(null), 1500);
	}

	if (links === null && error === null) {
		return (
			<div className="mt-8 grid gap-3" aria-hidden>
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						className="h-14 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800"
					/>
				))}
			</div>
		);
	}

	if (links !== null && links.length === 0) {
		return (
			<p className="mt-8 rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
				No links yet. Create your first one above.
			</p>
		);
	}

	return (
		<div className="mt-8">
			{error !== null && (
				<p role="alert" className="mb-4 text-sm text-rose-700 dark:text-rose-400">
					{error}
				</p>
			)}
			<ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
				{(links ?? []).map((link) => (
					<li
						key={link.slug}
						className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
					>
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									onClick={() => copyShortUrl(link)}
									title="Copy short link"
									className="font-mono text-sm font-medium text-zinc-900 transition hover:text-rose-700 dark:text-zinc-100 dark:hover:text-rose-400"
								>
									{link.short_url.replace(/^https?:\/\//, "")}
								</button>
								{copiedSlug === link.slug && (
									<span className="text-xs text-zinc-500 dark:text-zinc-400">
										Copied
									</span>
								)}
								{link.external_ref !== undefined && (
									<span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
										{link.external_ref}
									</span>
								)}
							</div>
							<p
								title={link.url}
								className="mt-1 max-w-md truncate text-sm text-zinc-500 dark:text-zinc-400"
							>
								{link.url}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-4 text-sm">
							<span className="text-zinc-500 tabular-nums dark:text-zinc-400">
								{link.clicks} {link.clicks === 1 ? "click" : "clicks"}
							</span>
							<span className="text-zinc-400 dark:text-zinc-500">
								{new Date(link.created_at).toLocaleDateString()}
							</span>
							{confirming === link.slug ? (
								<span className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => confirmDelete(link.slug)}
										className="rounded-md bg-rose-700 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-rose-600"
									>
										Confirm
									</button>
									<button
										type="button"
										onClick={() => setConfirming(null)}
										className="text-xs text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
									>
										Cancel
									</button>
								</span>
							) : (
								<button
									type="button"
									onClick={() => setConfirming(link.slug)}
									className="text-xs text-zinc-500 transition hover:text-rose-700 dark:hover:text-rose-400"
								>
									Delete
								</button>
							)}
						</div>
					</li>
				))}
			</ul>
			{cursor !== undefined && (
				<div className="mt-4 flex justify-center">
					<button
						type="button"
						onClick={loadMore}
						disabled={busy}
						className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
					>
						{busy ? "Loading…" : "Load more"}
					</button>
				</div>
			)}
		</div>
	);
}
