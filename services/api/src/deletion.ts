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

// Creates the users row on first sight of a session, unless the account has
// been deleted. The deleted_users guard is folded into the statement itself
// so it stays atomic against a deletion committing after a separate
// isDeletedUser check (the SELECT-then-write race the fast path leaves open).
export async function insertUserUnlessDeleted(
	db: D1Database,
	userId: string
): Promise<void> {
	await db
		.prepare(
			"INSERT INTO users (id, tier, created_at) SELECT ?, 'free', ? WHERE NOT EXISTS (SELECT 1 FROM deleted_users WHERE user_id = ?) ON CONFLICT (id) DO NOTHING"
		)
		.bind(userId, Math.floor(Date.now() / 1000), userId)
		.run();
}
