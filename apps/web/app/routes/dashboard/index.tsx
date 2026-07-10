import type { CreateLinkResponse, LinkSummary } from "@uwu/shared";
import { useState } from "react";
import { LinkCreate } from "@/components/link-create";
import { LinkTable } from "@/components/link-table";

export default function DashboardLinksPage() {
	const [latest, setLatest] = useState<LinkSummary | undefined>(undefined);

	function handleCreated(link: CreateLinkResponse) {
		setLatest({
			slug: link.slug,
			short_url: link.short_url,
			url: link.url,
			clicks: 0,
			created_at: new Date().toISOString()
		});
	}

	return (
		<div>
			<h1 className="text-2xl font-semibold tracking-tight">Links</h1>
			<div className="mt-6">
				<LinkCreate onCreated={handleCreated} />
			</div>
			<LinkTable prepend={latest} />
		</div>
	);
}
