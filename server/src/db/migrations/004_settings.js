export async function up(db) {
  await db.schema.createTable('app_settings', (t) => {
    t.string('key').primary();
    t.string('value').notNullable();
    t.string('updated_at').notNullable();
    t.string('updated_by');
  });
}
export async function down(db) {
  await db.schema.dropTableIfExists('app_settings');
}
