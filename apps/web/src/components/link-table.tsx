"use client";

import { useAuth } from "@clerk/react-router";
import type { LinkSummary } from "@uwu/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Stamp } from "@/components/postal/stamp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteLink, listLinks } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

export function LinkTable({ prepend }: { prepend?: LinkSummary }) {
	const { isLoaded, isSignedIn, getToken } = useAuth();
	const [links, setLinks] = useState<LinkSummary[] | null>(null);
	const [cursor, setCursor] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
	const seenPrepend = useRef<LinkSummary | undefined>(undefined);

	useEffect(() => {
		// Wait for Clerk to resolve the session; getToken() returns null before
		// isLoaded and would strand the UI on its loading skeleton.
		if (!isLoaded) {
			return;
		}
		if (!isSignedIn) {
			return;
		}
		let cancelled = false;
		(async () => {
			const token = await getToken();
			if (token === null) {
				if (!cancelled) {
					setError("Your session expired. Refresh and sign in again.");
				}
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
	}, [isLoaded, isSignedIn, getToken]);

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
					<Skeleton
						key={i}
						className="h-14 animate-pulse rounded-lg bg-secondary"
					/>
				))}
			</div>
		);
	}

	if (links !== null && links.length === 0) {
		return (
			<div className="mt-8 flex flex-col items-center gap-4 rounded-xl border border-dashed border-border p-10 text-center">
				<Stamp size={40} />
				<p className="text-sm text-muted-foreground">
					No links yet. Send your first one from the{" "}
					<a href="/" className="text-[color:var(--ring)] hover:opacity-80">
						front desk
					</a>
					.
				</p>
			</div>
		);
	}

	return (
		<div className="mt-8">
			{error !== null && (
				<p role="alert" className="mb-4 text-sm text-destructive">
					{error}
				</p>
			)}
			<ul className="divide-y divide-border rounded-xl border border-border bg-card">
				{(links ?? []).map((link) => (
					<li
						key={link.slug}
						className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
					>
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									onClick={() => copyShortUrl(link)}
									title="Copy short link"
									variant="ghost"
									className="font-mono text-sm font-medium text-foreground transition hover:text-[color:var(--ring)]"
								>
									{link.short_url.replace(/^https?:\/\//, "")}
								</Button>
								{copiedSlug === link.slug && (
									<span className="text-xs text-muted-foreground">
										Copied
									</span>
								)}
								{link.external_ref !== undefined && (
									<Badge className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
										{link.external_ref}
									</Badge>
								)}
							</div>
							<p
								title={link.url}
								className="mt-1 max-w-md truncate text-sm text-muted-foreground"
							>
								{link.url}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-4 text-sm">
							<span className="text-muted-foreground tabular-nums">
								{link.clicks} {link.clicks === 1 ? "click" : "clicks"}
							</span>
							<span className="text-muted-foreground">
								{new Date(link.created_at).toLocaleDateString()}
							</span>
							{confirming === link.slug ? (
								<span className="flex items-center gap-2">
									<Button
										type="button"
										onClick={() => confirmDelete(link.slug)}
										variant="destructive"
										className="rounded-md px-2.5 py-1 text-xs font-medium"
									>
										Confirm
									</Button>
									<Button
										type="button"
										onClick={() => setConfirming(null)}
										variant="ghost"
										className="text-xs text-muted-foreground transition hover:text-foreground"
									>
										Cancel
									</Button>
								</span>
							) : (
								<Button
									type="button"
									onClick={() => setConfirming(link.slug)}
									variant="ghost"
									className="text-xs text-muted-foreground transition hover:text-destructive"
								>
									Delete
								</Button>
							)}
						</div>
					</li>
				))}
			</ul>
			{cursor !== undefined && (
				<div className="mt-4 flex justify-center">
					<Button
						type="button"
						onClick={loadMore}
						disabled={busy}
						className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary disabled:opacity-60"
					>
						{busy ? "Loading…" : "Load more"}
					</Button>
				</div>
			)}
		</div>
	);
}
