import { ClerkProvider } from "@clerk/nextjs";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "uwu.land",
	description:
		"uwu.land is a fast, free URL shortener with an open API. Free forever, no ads, no account required."
};

export default function RootLayout({
	children
}: {
	children: ReactNode;
}) {
	return (
		<ClerkProvider>
			<html
				lang="en"
				className={`${GeistSans.variable} ${GeistMono.variable}`}
			>
				<body className="antialiased">{children}</body>
			</html>
		</ClerkProvider>
	);
}
