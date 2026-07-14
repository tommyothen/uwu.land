import type { ReactNode } from "react";
import { Link } from "react-router";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * Shared shell + prose primitives for the legal pages (privacy, terms,
 * acceptable-use, refunds). Mirrors the docs page: SiteHeader over a centred
 * max-w-3xl column, muted body text, hard-edged inline code. The flex-col shell
 * plus SiteFooter's `mt-auto` keeps the footer at the bottom on short pages.
 */
export function LegalPage({
	title,
	lastUpdated,
	children
}: {
	title: string;
	lastUpdated: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-[100dvh] flex-col">
			<SiteHeader />
			<main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-10 pb-20">
				<h1 className="text-3xl font-semibold tracking-tighter">{title}</h1>
				<p className="mt-2 font-mono text-sm text-muted-foreground">
					Last updated: {lastUpdated}
				</p>
				<div className="mt-8">{children}</div>
			</main>
			<SiteFooter />
		</div>
	);
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
	return (
		<h2
			id={id}
			className="mt-10 scroll-mt-24 text-xl font-semibold tracking-tight"
		>
			{children}
		</h2>
	);
}

export function P({ children }: { children: ReactNode }) {
	return <p className="mt-4 leading-relaxed text-muted-foreground">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
	return (
		<ul className="mt-4 list-disc space-y-2 pl-6 leading-relaxed text-muted-foreground">
			{children}
		</ul>
	);
}

export function OL({ children }: { children: ReactNode }) {
	return (
		<ol className="mt-4 list-decimal space-y-2 pl-6 leading-relaxed text-muted-foreground">
			{children}
		</ol>
	);
}

export function LI({ children }: { children: ReactNode }) {
	return <li>{children}</li>;
}

/** Inline code, hard-edged riso chip to match the docs page. */
export function C({ children }: { children: ReactNode }) {
	return (
		<code className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em] text-foreground">
			{children}
		</code>
	);
}

/**
 * A link that renders as a client-side `Link` for internal paths and a plain
 * anchor for anything with a scheme (http, mailto). Internal paths start with
 * `/` and carry no colon, so the colon test cleanly splits the two.
 */
export function A({ href, children }: { href: string; children: ReactNode }) {
	const className =
		"text-foreground underline underline-offset-2 hover:no-underline";
	if (href.includes(":")) {
		const isWeb = href.startsWith("http");
		return (
			<a
				href={href}
				className={className}
				{...(isWeb ? { target: "_blank", rel: "noreferrer" } : {})}
			>
				{children}
			</a>
		);
	}
	return (
		<Link to={href} className={className}>
			{children}
		</Link>
	);
}
