import { A, C, H2, LegalPage, LI, OL, P, UL } from "@/components/legal-page";
import type { Route } from "./+types/acceptable-use";

export const meta: Route.MetaFunction = () => [
	{ title: "Acceptable Use Policy | uwu.land" },
	{
		name: "description",
		content:
			"What you may not link to on uwu.land, and the measures we may use against abuse, from destination blocks to account termination."
	}
];

export default function AcceptableUsePage() {
	return (
		<LegalPage title="Acceptable Use Policy" lastUpdated="14 July 2026">
			<P>
				uwu.land forwards visitors to destinations chosen by other people, which
				makes it a tempting tool for anyone trying to hide a bad destination
				behind a friendly short link. This policy is how we keep the post office
				honest. It forms part of the <A href="/terms">Terms of Service</A>.
			</P>

			<H2 id="prohibited">What you may not link to</H2>
			<P>Do not create links that point to, or are used for:</P>
			<UL>
				<LI>Phishing or credential harvesting.</LI>
				<LI>Malware, viruses, or other harmful code.</LI>
				<LI>
					Child sexual abuse material. Zero tolerance: material we reasonably
					believe to be CSAM is disabled and reported where legally required or
					appropriate.
				</LI>
				<LI>
					Content or activity that is illegal under the law of England and Wales
					or the law that applies to you.
				</LI>
				<LI>Spam or mass unsolicited promotion.</LI>
				<LI>
					Deceptive or scam destinations, including pages that impersonate other
					sites or people.
				</LI>
				<LI>Doxxing, harassment, or threats against anyone.</LI>
				<LI>Content that incites violence.</LI>
				<LI>
					Piracy or "warez", meaning unauthorised copies of copyrighted
					material.
				</LI>
				<LI>Attempts to probe, bypass, or attack anyone else's security.</LI>
				<LI>
					uwu.land itself or its subdomains, used to nest or loop redirects.
				</LI>
			</UL>
			<P>
				A destination that starts clean and later turns into one of the above is
				treated the same as one that was bad from the start.
			</P>

			<H2 id="enforcement">How we enforce this</H2>
			<P>
				Depending on the severity and intent of a violation, we may use one or
				more of the following measures:
			</P>
			<OL>
				<LI>
					Blocking a destination. Known-bad destinations are refused at creation
					time with a <C>url_banned</C> response, and existing links to them can
					be purged.
				</LI>
				<LI>
					Temporary request blocks. Repeated attempts to create links to an
					already-blocked destination earn the requesting IP a temporary block
					(about 24 hours). We do not attach the creator's IP to individual
					links, so this applies to repeated abusive attempts, not to a single
					link reported later.
				</LI>
				<LI>
					Link removal. Individual links that violate this policy are removed,
					whether they were created anonymously or from an account.
				</LI>
				<LI>
					Account suspension or termination. Serious or repeat violations can end
					an account.
				</LI>
			</OL>
			<P>
				We act as soon as reasonably practicable after reviewing a report, and we
				may preserve relevant records, investigate, and cooperate with law
				enforcement where appropriate. This is a small service run by one person,
				so we cannot promise a fixed response time.
			</P>

			<H2 id="reporting">Reporting abuse</H2>
			<P>
				If a uwu.land link is being used for anything on the list above, email{" "}
				<A href="mailto:support@uwu.land">support@uwu.land</A> with the short link
				and what you found. Please do not include the illegal material itself.
				Reports are read by a human and acted on as quickly as we reasonably can.
			</P>

			<H2 id="contact">Contact</H2>
			<P>
				Questions about this policy, or an abuse report:{" "}
				<A href="mailto:support@uwu.land">support@uwu.land</A>.
			</P>
		</LegalPage>
	);
}
