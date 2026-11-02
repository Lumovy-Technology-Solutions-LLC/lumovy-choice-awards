export async function up(db) {
  await db.schema.alterTable('contests', (t) => {
    // true = every region that is switched on takes part (regions list is then ignored)
    t.boolean('is_global').notNullable().defaultTo(false);
  });
}
export async function down(db) {
  await db.schema.alterTable('contests', (t) => t.dropColumn('is_global'));
}
