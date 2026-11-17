// Gender is optional on each employee (female, male, other; empty = not given).
// A contest can be limited to some genders; an empty list means everyone in the chosen regions.
export async function up(db) {
  await db.schema.alterTable('users', (t) => { t.string('gender', 16).nullable(); });
  await db.schema.alterTable('contests', (t) => { t.text('genders').notNullable().defaultTo('[]'); });
}
export async function down(db) {
  await db.schema.alterTable('contests', (t) => t.dropColumn('genders'));
  await db.schema.alterTable('users', (t) => t.dropColumn('gender'));
}
