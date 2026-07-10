"use client";

import type { ApiKeySummary, CreateKeyResponse } from "@uwu/shared";
import { useState } from "react";
import { KeyCreate } from "@/components/key-create";
import { KeyList } from "@/components/key-list";

export default function DashboardKeysPage() {
	const [latest, setLatest] = useState<ApiKeySummary | undefined>(undefined);

	function handleCreated(key: CreateKeyResponse) {
		// Only non-secret fields leave the reveal panel.
		setLatest({
			id: key.id,
			name: key.name,
			display_prefix: key.display_prefix,
			created_at: new Date().toISOString(),
			last_used_at: null
		});
	}

	return (
		<div>
			<h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
			<div className="mt-6">
				<KeyCreate onCreated={handleCreated} />
			</div>
			<KeyList prepend={latest} />
		</div>
	);
}
