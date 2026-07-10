"use client";

import { useAuth } from "@clerk/react-router";
import type { ApiKeySummary } from "@uwu/shared";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteKey, listKeys } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

export function KeyList({ prepend }: { prepend?: ApiKeySummary }) {
	const { getToken } = useAuth();
	const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const seenPrepend = useRef<ApiKeySummary | undefined>(undefined);
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
				const page = await listKeys(token);
				if (!cancelled) {
					setKeys(page.keys);
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
			setKeys((current) =>
				current === null
					? [prepend]
					: [prepend, ...current.filter((k) => k.id !== prepend.id)]
			);
		}
	}, [prepend]);

	async function confirmRevoke(id: string) {
		setConfirming(null);
		const previous = keys;
		setKeys((current) => current?.filter((k) => k.id !== id) ?? null);
		try {
			const token = await getToken();
			if (token === null) {
				return;
			}
			await deleteKey(id, token);
		} catch (err) {
			setKeys(previous);
			setError(friendlyError(err));
		}
	}

	if (keys === null && error === null) {
		return (
			<div className="mt-8 grid gap-3" aria-hidden>
				{[0, 1].map((i) => (
					<Skeleton
						key={i}
						className="h-14 animate-pulse rounded-lg bg-secondary"
					/>
				))}
			</div>
		);
	}

	if (keys !== null && keys.length === 0) {
		return (
			<p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
				No API keys yet. Create one above to call the API.
			</p>
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
				{(keys ?? []).map((key) => (
					<li
						key={key.id}
						className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
					>
						<div className="min-w-0">
							<p className="text-sm font-medium text-foreground">
								{key.name}
							</p>
							<p className="mt-1 font-mono text-xs text-muted-foreground">
								{key.display_prefix}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-4 text-sm">
							<span className="text-muted-foreground">
								Created {new Date(key.created_at).toLocaleDateString()}
							</span>
							<span className="text-muted-foreground">
								{key.last_used_at === null
									? "Never used"
									: `Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
							</span>
							{confirming === key.id ? (
								<span className="flex items-center gap-2">
									<Button
										type="button"
										onClick={() => confirmRevoke(key.id)}
										variant="destructive"
										className="rounded-md px-2.5 py-1 text-xs font-medium"
									>
										Confirm
									</Button>
									<Button
										type="button"
										onClick={() => setConfirming(null)}
										className="text-xs text-muted-foreground transition hover:text-foreground"
									>
										Cancel
									</Button>
								</span>
							) : (
								<Button
									type="button"
									onClick={() => setConfirming(key.id)}
									className="text-xs text-muted-foreground transition hover:text-destructive"
								>
									Revoke
								</Button>
							)}
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
