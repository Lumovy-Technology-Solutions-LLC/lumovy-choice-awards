// An entry can hold several photos of the same subject (different angles). The first photo stays on the entry itself;
// extra angles live in entry_images. An entry now points at the person who made it (competitor_user_id), and a contest
// can cap how many entries one person may have (max_entries_per_person; null = no cap, set by HR per contest).
export async function up(db) {
  await db.schema.createTable('entry_images', (t) => {
    t.increments('id');
    t.integer('entry_id').notNullable().references('entries.id').onDelete('CASCADE');
    t.integer('position').notNullable().defaultTo(0);
    t.string('file_key').notNullable();
    t.string('thumb_key');
    t.string('mime');
    t.string('ext');
    t.integer('size');
    t.string('alt_text').defaultTo('');
    t.index(['entry_id', 'position']);
  });
  await db.schema.alterTable('entries', (t) => { t.integer('competitor_user_id').nullable(); });
  await db.schema.alterTable('contests', (t) => { t.integer('max_entries_per_person').nullable(); });
}
export async function down(db) {
  await db.schema.alterTable('contests', (t) => t.dropColumn('max_entries_per_person'));
  await db.schema.alterTable('entries', (t) => t.dropColumn('competitor_user_id'));
  await db.schema.dropTableIfExists('entry_images');
}
