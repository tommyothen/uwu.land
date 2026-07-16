// A permanent record of deleted Clerk user ids lives in the deleted_users
// table (see packages/db/src/schema.ts). Any path that could recreate a user
// row — a late Clerk upsert, a Stripe subscription echo, a still-valid session
// JWT — must consult this first so a deleted account stays deleted.
export async function isDeletedUser(
	db: D1Database,
	userId: string
): Promise<boolean> {
	const row = await db
		.prepare("SELECT 1 FROM deleted_users WHERE user_id = ?")
		.bind(userId)
		.first();
	return row !== null;
}
