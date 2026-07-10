import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "uwu.land",
	description:
		"uwu.land is a fast, free URL shortener with an open API — free forever, no ads, no account required."
};

export default function RootLayout({
	children
}: {
	children: ReactNode;
}) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
