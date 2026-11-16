// Contests are always a top 3 now. Drafts are set to 3; contests already running or finished keep their places so their results do not change.
export async function up(db) {
  await db('contests').where({ status: 'draft' }).update({ places: 3 });
}
export async function down() { /* nothing to undo */ }
