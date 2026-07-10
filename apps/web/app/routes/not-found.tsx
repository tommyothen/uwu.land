import type { CSSProperties } from "react";
import { Link } from "react-router";
import { AirmailStripe } from "@/components/postal/airmail-stripe";
import { CloudField } from "@/components/postal/cloud-field";
import { ReturnAddress } from "@/components/postal/return-address";
import { RubberStamp } from "@/components/postal/rubber-stamp";

/**
 * The dead letter office (spec §8): same envelope frame, a red RETURN TO SENDER
 * stamp pressed over the 404 numerals, one plain CTA back to the post office.
 * The AIR MAIL stamp does not repeat here; the red stamp is this page's stamp.
 */
export default function ShortLinkNotFound() {
	return (
		<div
			className="landing-root relative flex min-h-[100dvh] flex-col overflow-hidden"
			style={{ "--field-h": "120px" } as CSSProperties}
		>
			<AirmailStripe />

			<div className="absolute top-4 left-5 z-[4] sm:top-7 sm:left-[34px]">
				<ReturnAddress />
			</div>

			<main className="relative z-[4] flex flex-1 flex-col items-center justify-center px-6 pb-32 text-center">
				<div className="relative inline-flex items-center justify-center">
					<span className="font-display text-[clamp(6rem,14vw,11rem)] leading-none font-extrabold tracking-[-0.02em] text-foreground">
						404
					</span>
					<RubberStamp
						lines={["RETURN TO SENDER", "NO SUCH ADDRESS"]}
						tone="red"
						shape="box"
						rotate={-8}
						pressFrom={1.4}
						className="rubber-stamp--lg absolute"
					/>
				</div>

				<p className="mt-8 max-w-[40ch] text-base text-muted-foreground">
					Nothing's registered at this address. The link may have expired, or it
					never existed.
				</p>

				<Link
					to="/"
					className="press mt-8 inline-block rounded-[10px] bg-primary px-5 py-2.5 text-[15px] font-semibold text-primary-foreground shadow-[3px_3px_0_var(--shadow-ink)]"
				>
					Back to the post office
				</Link>
			</main>

			<CloudField />
		</div>
	);
}
