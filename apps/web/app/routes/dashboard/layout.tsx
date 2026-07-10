import { UserButton } from "@clerk/react-router";
import { getAuth } from "@clerk/react-router/server";
import { Link, Outlet, redirect } from "react-router";
import { ThemeToggle } from "@/components/theme-toggle";
import { Toaster } from "@/components/ui/sonner";
import type { Route } from "./+types/layout";

const NAV = [
	{ href: "/dashboard", label: "Links" },
	{ href: "/dashboard/keys", label: "API keys" },
	{ href: "/dashboard/account", label: "Account" }
];

export async function loader(args: Route.LoaderArgs) {
	const { userId } = await getAuth(args);
	if (!userId) {
		throw redirect("/sign-in");
	}
	return null;
}

export default function DashboardLayout() {
	return (
		<div className="min-h-[100dvh]">
			<header className="border-b border-border">
				<div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
					<div className="flex items-center gap-8">
						<Link
							to="/"
							className="font-display text-lg font-extrabold tracking-[-0.02em]"
						>
							<span className="uwu-gradient">UwU.</span>Land
						</Link>
						<nav className="flex items-center gap-5 text-sm">
							{NAV.map((item) => (
								<Link
									key={item.href}
								to={item.href}
									className="text-muted-foreground transition hover:text-foreground"
								>
									{item.label}
								</Link>
							))}
						</nav>
					</div>
					<div className="flex items-center gap-3">
						<ThemeToggle />
						<UserButton />
					</div>
				</div>
			</header>
			<div aria-hidden="true" className="airmail-hairline" />
			<main className="mx-auto w-full max-w-5xl px-6 py-10">
				<Outlet />
			</main>
			<Toaster />
		</div>
	);
}
