import { linkPagesOnDomain, markForDeletion, parseBannableDomain } from "./domain-sweep.mjs";

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const domains = args.filter((arg) => arg !== "--yes");
if (domains.length !== 1) {
	console.error("Usage: purge-domain.mjs DOMAIN [--yes]");
	process.exit(1);
}

const domain = parseBannableDomain(domains[0]);
if (domain === null) {
	console.error("Usage: purge-domain.mjs DOMAIN [--yes] (DOMAIN must be a hostname, not a bare public suffix)");
	process.exit(1);
}

let found = 0;
for (const rows of linkPagesOnDomain(domain)) {
	for (const row of rows) {
		console.log(`${confirmed ? "Deleting" : "Would delete"} ${row.slug} (${row.url})`);
	}
	if (confirmed) markForDeletion(rows);
	found += rows.length;
}

if (found === 0) {
	console.log(`No links found for ${domain}.`);
} else if (confirmed) {
	console.log(`Marked ${found} link(s) for deletion; the reconciler cron removes up to 100 every five minutes.`);
}
