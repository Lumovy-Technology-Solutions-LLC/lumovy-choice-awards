export async function up(db) {
  await db.schema.createTable('regions', (t) => {
    t.string('code').primary();
    t.string('name').notNullable();
    t.string('timezone').notNullable().defaultTo('Asia/Kolkata');
    t.boolean('enabled').notNullable().defaultTo(false);
  });

  await db.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('name').notNullable();
    t.string('email').notNullable().unique();
    t.string('team').defaultTo('');
    t.string('region').notNullable().defaultTo('IN');
    t.string('role').notNullable().defaultTo('employee'); // employee | admin
    t.boolean('active').notNullable().defaultTo(true);
    t.string('password_hash');
    t.integer('failed_logins').notNullable().defaultTo(0);
    t.string('locked_until');
    t.string('last_login_at');
    t.string('created_at').notNullable();
    t.index(['region', 'active']);
  });

  await db.schema.createTable('otp_codes', (t) => {
    t.increments('id');
    t.string('email').notNullable().index();
    t.string('code_hash').notNullable();
    t.string('expires_at').notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.boolean('used').notNullable().defaultTo(false);
    t.string('created_at').notNullable();
  });

  await db.schema.createTable('contests', (t) => {
    t.increments('id');
    t.string('name').notNullable();
    t.string('theme').defaultTo('');
    t.text('description').defaultTo('');
    t.text('rules').defaultTo('');
    t.string('banner_file');
    t.text('entry_types').notNullable().defaultTo('["image"]'); // json array: image|writing|document|video
    t.text('regions').notNullable().defaultTo('["IN"]'); // json array of region codes
    t.integer('places').notNullable().defaultTo(3);
    t.string('status').notNullable().defaultTo('draft'); // draft | live | closed | published
    t.boolean('announced').notNullable().defaultTo(false);
    t.string('timezone').notNullable().defaultTo('Asia/Kolkata');
    t.string('end_at');
    t.string('started_at');
    t.string('closed_at');
    t.string('published_at');
    t.integer('next_entry_no').notNullable().defaultTo(1);
    t.integer('copied_from');
    t.integer('created_by');
    t.string('created_at').notNullable();
    t.string('updated_at').notNullable();
    t.index(['status']);
  });

  await db.schema.createTable('entries', (t) => {
    t.increments('id');
    t.integer('contest_id').notNullable().references('contests.id').onDelete('CASCADE');
    t.integer('number').notNullable();
    t.string('type').notNullable(); // image | writing | document | video
    t.string('title').notNullable().defaultTo('');
    t.text('description').notNullable().defaultTo('');
    t.string('alt_text').defaultTo('');
    t.string('file_key'); // random name on disk
    t.string('thumb_key');
    t.string('mime');
    t.string('ext');
    t.integer('size');
    t.integer('page_count');
    t.text('body'); // pasted writing
    t.string('competitor_name').notNullable().defaultTo('');
    t.string('created_at').notNullable();
    t.string('updated_at').notNullable();
    t.unique(['contest_id', 'number']);
  });

  // Who has voted (visible to HR). Deliberately holds no entry information in the clear.
  await db.schema.createTable('voter_status', (t) => {
    t.integer('contest_id').notNullable().references('contests.id').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('users.id');
    t.string('submitted_at').notNullable();
    t.text('receipt'); // the voter's own picks, encrypted; never exposed by any admin API
    t.primary(['contest_id', 'user_id']);
  });

  // Votes carry NO user reference: nobody can tell who voted for what.
  await db.schema.createTable('votes', (t) => {
    t.increments('id');
    t.integer('contest_id').notNullable().references('contests.id').onDelete('CASCADE');
    t.integer('entry_id').notNullable().references('entries.id');
    t.integer('rank').notNullable();
    t.integer('points').notNullable();
    t.index(['contest_id', 'entry_id']);
  });

  await db.schema.createTable('ballot_drafts', (t) => {
    t.integer('contest_id').notNullable().references('contests.id').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('users.id');
    t.text('picks').notNullable().defaultTo('[]');
    t.string('updated_at').notNullable();
    t.primary(['contest_id', 'user_id']);
  });

  await db.schema.createTable('email_templates', (t) => {
    t.increments('id');
    t.integer('contest_id'); // null = global default
    t.string('key').notNullable();
    t.string('subject').notNullable();
    t.text('body').notNullable();
    t.string('updated_at').notNullable();
    t.unique(['contest_id', 'key']);
  });

  await db.schema.createTable('outbox', (t) => {
    t.increments('id');
    t.integer('contest_id');
    t.string('kind').notNullable();
    t.string('to_email').notNullable();
    t.string('to_name');
    t.string('subject').notNullable();
    t.text('html').notNullable();
    t.text('text');
    t.string('status').notNullable().defaultTo('queued'); // queued | sent | captured | failed
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('error');
    t.string('created_at').notNullable();
    t.string('sent_at');
    t.index(['status']);
    t.index(['contest_id']);
  });

  await db.schema.createTable('audit_log', (t) => {
    t.increments('id');
    t.integer('actor_id');
    t.string('actor_name');
    t.integer('contest_id');
    t.string('action').notNullable();
    t.text('detail');
    t.string('at').notNullable();
    t.index(['contest_id']);
  });
}

export async function down(db) {
  for (const t of ['audit_log', 'outbox', 'email_templates', 'ballot_drafts', 'votes', 'voter_status', 'entries', 'contests', 'otp_codes', 'users', 'regions'])
    await db.schema.dropTableIfExists(t);
}
