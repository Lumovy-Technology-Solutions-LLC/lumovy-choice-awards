export async function up(db) {
  await db.schema.alterTable('outbox', (t) => {
    t.string('claimed_by'); // which worker instance is sending this row
    t.string('claimed_at');
  });
}
export async function down(db) {
  await db.schema.alterTable('outbox', (t) => { t.dropColumn('claimed_by'); t.dropColumn('claimed_at'); });
}
