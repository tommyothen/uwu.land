import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	_loadContext: AppLoadContext
) {
	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} />,
		{ signal: request.signal }
	);

	// Not optional: the worker sends `X-Content-Type-Options: nosniff`, so a
	// document with no declared type is rendered as plain text instead of HTML
	// and no script on the page ever runs. Nothing else in the response chain
	// sets this — the Cloudflare asset layer types /assets/*, but documents are
	// built here.
	responseHeaders.set("Content-Type", "text/html; charset=utf-8");

	return new Response(body, {
		headers: responseHeaders,
		status: responseStatusCode
	});
}
