import { findLinksOnDomain, markForDeletion, parseBannableDomain } from "./domain-sweep.mjs";

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

const rows = findLinksOnDomain(domain);
if (rows.length === 0) {
	console.log(`No links found for ${domain}.`);
	process.exit(0);
}

for (const row of rows) {
	console.log(`${confirmed ? "Deleting" : "Would delete"} ${row.slug} (${row.url})`);
}
if (confirmed) {
	markForDeletion(rows.map((row) => row.slug));
	console.log(`Marked ${rows.length} link(s) for deletion; the reconciler cron removes up to 100 every five minutes.`);
}
