import {
	index,
	type RouteConfig, 
	route
} from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("404", "routes/not-found.tsx"),
	route("docs", "routes/docs.tsx"),
	route("sign-in/*", "routes/sign-in/route.tsx"),
	route("sign-up/*", "routes/sign-up/route.tsx"),
	route("dashboard", "routes/dashboard/layout.tsx", [
		index("routes/dashboard/index.tsx"),
		route("keys", "routes/dashboard/keys.tsx"),
		route("account", "routes/dashboard/account.tsx")
	]),
	route("*", "routes/catch-all.tsx")
] satisfies RouteConfig;
