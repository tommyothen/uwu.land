"use client";

import { useAuth } from "@clerk/react-router";
import { type MeResponse, TIERS } from "@uwu/shared";
import { useEffect, useRef, useState } from "react";
import { getMe } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

const ROWS = [
	{
		label: "Links per day",
		value: (tier: "free" | "pro") => TIERS[tier].createPerDay
	},
	{
		label: "API requests per minute",
		value: (tier: "free" | "pro") => TIERS[tier].apiPerMin
	},
	{
		label: "API keys",
		value: (tier: "free" | "pro") => TIERS[tier].apiKeys
	}
];

export function AccountPanel() {
	const { getToken } = useAuth();
	const [me, setMe] = useState<MeResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
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
				const response = await getMe(token);
				if (!cancelled) {
					setMe(response);
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

	if (error !== null) {
		return (
			<p role="alert" className="mt-6 text-sm text-rose-700 dark:text-rose-400">
				{error}
			</p>
		);
	}

	if (me === null) {
		return (
			<div className="mt-6 grid gap-3" aria-hidden>
				{[0, 1].map((i) => (
					<div
						key={i}
						className="h-20 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800"
					/>
				))}
			</div>
		);
	}

	return (
		<div className="mt-6">
			<p className="text-sm text-zinc-600 dark:text-zinc-400">
				Current plan:{" "}
				<span className="font-medium capitalize text-zinc-900 dark:text-zinc-100">
					{me.tier}
				</span>
			</p>
			<div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
				<table className="w-full text-left text-sm">
					<thead>
						<tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
							<th className="p-4 font-medium">Limit</th>
							<th
								className={`p-4 font-medium capitalize ${
									me.tier === "free"
										? "text-zinc-900 dark:text-zinc-100"
										: ""
								}`}
							>
								Free{me.tier === "free" ? " (you)" : ""}
							</th>
							<th
								className={`p-4 font-medium ${
									me.tier === "pro" ? "text-zinc-900 dark:text-zinc-100" : ""
								}`}
							>
								Pro{me.tier === "pro" ? " (you)" : ""}
								<span className="ml-2 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-normal normal-case text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
									coming soon
								</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{ROWS.map((row) => (
							<tr
								key={row.label}
								className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800"
							>
								<td className="p-4 text-zinc-600 dark:text-zinc-400">
									{row.label}
								</td>
								<td className="p-4 tabular-nums">{row.value("free")}</td>
								<td className="p-4 tabular-nums">{row.value("pro")}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
				Anonymous shortening stays free forever regardless of plan. Pro
				pricing lands with the upgrade flow.
			</p>
		</div>
	);
}
