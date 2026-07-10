import type { ApiError, ErrorCode } from "@uwu/shared";

export function errorResponse(
	status: number,
	code: ErrorCode,
	message: string
): Response {
	const body: ApiError = { status, code, message };
	return Response.json(body, { status });
}
