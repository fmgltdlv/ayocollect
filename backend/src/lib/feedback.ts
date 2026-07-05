export type FeedbackRow = {
  id: number;
  user_email: string;
  message: string;
  page_url: string | null;
  created_at: string;
  read_at: string | null;
  read_by: string | null;
};

export async function submitFeedback(
  db: D1Database,
  userEmail: string,
  message: string,
  pageUrl?: string
): Promise<FeedbackRow> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Message required');
  if (trimmed.length > 4000) throw new Error('Message too long (max 4000 characters)');

  const result = await db
    .prepare(
      `INSERT INTO user_feedback (user_email, message, page_url)
       VALUES (?, ?, ?)`
    )
    .bind(userEmail.trim().toLowerCase(), trimmed, pageUrl?.trim() || null)
    .run();

  const row = await db
    .prepare('SELECT * FROM user_feedback WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<FeedbackRow>();
  if (!row) throw new Error('Failed to save feedback');
  return row;
}

export async function listFeedback(db: D1Database, limit = 50): Promise<FeedbackRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM user_feedback ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<FeedbackRow>();
  return results ?? [];
}

export async function countUnreadFeedback(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM user_feedback WHERE read_at IS NULL')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function markFeedbackRead(
  db: D1Database,
  id: number,
  adminEmail: string
): Promise<FeedbackRow | null> {
  await db
    .prepare(
      `UPDATE user_feedback SET read_at = datetime('now'), read_by = ?
       WHERE id = ? AND read_at IS NULL`
    )
    .bind(adminEmail.trim().toLowerCase(), id)
    .run();

  return db.prepare('SELECT * FROM user_feedback WHERE id = ?').bind(id).first<FeedbackRow>();
}
