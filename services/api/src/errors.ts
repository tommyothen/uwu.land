import type { ApiError, ErrorCode } from "@uwu/shared";

export function errorResponse(
	status: number,
	code: ErrorCode,
	message: string,
	retryAfterSeconds?: number
): Response {
	const body: ApiError = {
		status,
		code,
		message,
		...(retryAfterSeconds === undefined
			? {}
			: { retry_after: retryAfterSeconds })
	};
	return Response.json(body, {
		status,
		headers:
			retryAfterSeconds === undefined
				? undefined
				: { "Retry-After": String(retryAfterSeconds) }
	});
}
