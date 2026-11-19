// Well-known general-purpose URL shorteners. An anonymous link to one hides
// its real destination from the ban list, so only signed-in callers, who can
// be dealt with by hand, may point at them.
const URL_SHORTENERS = new Set([
	"adf.ly",
	"bit.ly",
	"bitly.com",
	"bl.ink",
	"buff.ly",
	"clck.ru",
	"cutt.ly",
	"dub.sh",
	"is.gd",
	"j.mp",
	"ow.ly",
	"rb.gy",
	"rebrand.ly",
	"s.id",
	"short.gy",
	"short.io",
	"shorte.st",
	"shorturl.at",
	"t.co",
	"t.ly",
	"tiny.cc",
	"tinyurl.com",
	"v.gd"
]);

/** True when a canonical hostname is a known shortener or a subdomain of one. */
export function isUrlShortener(hostname: string): boolean {
	const labels = hostname.split(".");
	return labels.some((_, index) =>
		URL_SHORTENERS.has(labels.slice(index).join("."))
	);
}
