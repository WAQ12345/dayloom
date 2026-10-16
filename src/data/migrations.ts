import type { SqlDb, SqlExecutor } from './sql.ts';

export const DATABASE_NAME = 'daily-life.db';

export const DEFAULT_CATEGORIES = ['电子设备', '家电', '服饰', '图书', '运动用品', '日用品', '其他'];

type Migration = { version: number; up: (tx: SqlExecutor) => Promise<void> };

/** Ordered, append-only migrations. Never edit a released migration; add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: async (tx) => {
      await tx.exec(`
        CREATE TABLE meals(
          id TEXT PRIMARY KEY NOT NULL,
          date TEXT NOT NULL,
          meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
          name TEXT NOT NULL,
          kcal REAL NOT NULL CHECK(kcal >= 0),
          time TEXT,
          note TEXT,
          photo TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX meals_date ON meals(date);
        CREATE TABLE food_favorites(
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          kcal REAL NOT NULL CHECK(kcal >= 0),
          meal_type TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE day_energy(
          date TEXT PRIMARY KEY NOT NULL,
          metabolism REAL,
          expenditure REAL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE food_settlements(
          date TEXT PRIMARY KEY NOT NULL,
          confirmed INTEGER NOT NULL,
          stale INTEGER NOT NULL DEFAULT 0,
          intake REAL,
          total REAL,
          note TEXT,
          settled_at INTEGER NOT NULL
        );
        CREATE TABLE water(
          id TEXT PRIMARY KEY NOT NULL,
          date TEXT NOT NULL,
          time TEXT NOT NULL,
          amount_ml REAL NOT NULL CHECK(amount_ml > 0),
          note TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX water_date ON water(date);
        CREATE TABLE tasks(
          id TEXT PRIMARY KEY NOT NULL,
          date TEXT NOT NULL,
          name TEXT NOT NULL,
          priority TEXT NOT NULL CHECK(priority IN ('normal','important')),
          project TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('todo','done','cancelled')),
          sort_order INTEGER NOT NULL,
          note TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX tasks_date ON tasks(date);
        CREATE TABLE plan_settlements(
          date TEXT PRIMARY KEY NOT NULL,
          summary TEXT,
          done_count INTEGER NOT NULL,
          total_count INTEGER NOT NULL,
          stale INTEGER NOT NULL DEFAULT 0,
          settled_at INTEGER NOT NULL
        );
        CREATE TABLE categories(
          name TEXT PRIMARY KEY NOT NULL,
          sort INTEGER NOT NULL
        );
        CREATE TABLE items(
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          purchase_date TEXT,
          price_cents INTEGER CHECK(price_cents IS NULL OR price_cents >= 0),
          location TEXT,
          brand TEXT,
          note TEXT,
          photo TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE settings(
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE drafts(
          key TEXT PRIMARY KEY NOT NULL,
          date TEXT,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE ai_sessions(
          id TEXT PRIMARY KEY NOT NULL,
          created_at INTEGER NOT NULL,
          question TEXT NOT NULL,
          model TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          refs TEXT NOT NULL,
          answer TEXT,
          citations TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('success','error','cancelled')),
          error TEXT
        );
      `);
      let sort = 0;
      for (const name of DEFAULT_CATEGORIES) await tx.run('INSERT INTO categories(name,sort) VALUES(?,?)', [name, sort++]);
    },
  },
  {
    version: 2,
    up: async (tx) => {
      await tx.exec('ALTER TABLE tasks ADD COLUMN order_level INTEGER NOT NULL DEFAULT 2 CHECK(order_level IN (1,2,3));');
    },
  },
  {
    version: 3,
    // Life tools: shopping list plus memberships / fixed expenses. Only new tables; old rows untouched.
    // seq is a per-table insertion counter used as the final, storage-independent tie breaker.
    up: async (tx) => {
      await tx.exec(`
        CREATE TABLE shopping_items(
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          note TEXT,
          status TEXT NOT NULL CHECK(status IN ('pending','done')),
          seq INTEGER NOT NULL UNIQUE CHECK(seq >= 1),
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          updated_at INTEGER NOT NULL,
          CHECK((status = 'done') = (completed_at IS NOT NULL))
        );
        CREATE INDEX shopping_items_status ON shopping_items(status);
        CREATE TABLE life_records(
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('membership','fixed')),
          name TEXT NOT NULL,
          start_date TEXT NOT NULL,
          amount_cents INTEGER CHECK(amount_cents IS NULL OR amount_cents >= 0),
          note TEXT,
          seq INTEGER NOT NULL UNIQUE CHECK(seq >= 1),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX life_records_kind ON life_records(kind, start_date);
      `);
    },
  },
  {
    version: 4,
    up: async tx => {
      await tx.exec(`
        CREATE TABLE bazi_profiles(id TEXT PRIMARY KEY NOT NULL,nickname TEXT NOT NULL,input_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE bazi_charts(id TEXT PRIMARY KEY NOT NULL,profile_id TEXT NOT NULL REFERENCES bazi_profiles(id) ON DELETE CASCADE,input_json TEXT NOT NULL,result_json TEXT NOT NULL,algorithm_version TEXT NOT NULL,created_at INTEGER NOT NULL);
        CREATE INDEX bazi_charts_profile ON bazi_charts(profile_id,created_at);
        CREATE TABLE ai_conversations(id TEXT PRIMARY KEY NOT NULL,tool TEXT NOT NULL CHECK(tool IN ('food','bazi')),profile_id TEXT,snapshot TEXT NOT NULL,refs TEXT NOT NULL,prompt_version TEXT NOT NULL,created_at INTEGER NOT NULL,CHECK((tool='food' AND profile_id IS NULL) OR (tool='bazi' AND profile_id IS NOT NULL)));
        CREATE TABLE ai_messages(id TEXT PRIMARY KEY NOT NULL,conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,settings_json TEXT NOT NULL,usage_json TEXT,status TEXT NOT NULL CHECK(status IN ('success','error','cancelled')),error TEXT,created_at INTEGER NOT NULL,seq INTEGER NOT NULL CHECK(seq>=1),UNIQUE(conversation_id,seq));
        CREATE INDEX ai_messages_conversation ON ai_messages(conversation_id,seq);
      `);
      await migrateLegacyAi(tx);
    },
  },
  {
    version: 5,
    up: async tx => {
      // Rebuild both sides with foreign_keys ON; removing the old parent can never cascade into saved messages.
      await tx.exec(`
        CREATE TABLE ideas(id TEXT PRIMARY KEY NOT NULL,body TEXT NOT NULL,tags_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE INDEX ideas_created ON ideas(created_at DESC,id DESC);
        CREATE TEMP TABLE saved_ai_messages AS SELECT * FROM ai_messages;
        DROP TABLE ai_messages;
        CREATE TABLE ai_conversations_new(id TEXT PRIMARY KEY NOT NULL,tool TEXT NOT NULL CHECK(tool IN ('food','bazi','ideas')),profile_id TEXT,snapshot TEXT NOT NULL,refs TEXT NOT NULL,prompt_version TEXT NOT NULL,created_at INTEGER NOT NULL,CHECK((tool IN ('food','ideas') AND profile_id IS NULL) OR (tool='bazi' AND profile_id IS NOT NULL)));
        INSERT INTO ai_conversations_new SELECT * FROM ai_conversations;
        DROP TABLE ai_conversations;
        ALTER TABLE ai_conversations_new RENAME TO ai_conversations;
        CREATE TABLE ai_messages(id TEXT PRIMARY KEY NOT NULL,conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,settings_json TEXT NOT NULL,usage_json TEXT,status TEXT NOT NULL CHECK(status IN ('success','error','cancelled')),error TEXT,created_at INTEGER NOT NULL,seq INTEGER NOT NULL CHECK(seq>=1),UNIQUE(conversation_id,seq));
        INSERT INTO ai_messages SELECT * FROM saved_ai_messages;
        DROP TABLE saved_ai_messages;
        CREATE INDEX ai_messages_conversation ON ai_messages(conversation_id,seq);
      `);
    },
  },
  {
    version: 6,
    up: async tx => {
      await tx.exec(`
        CREATE TABLE task_templates(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,note TEXT NOT NULL,order_level INTEGER NOT NULL CHECK(order_level IN (1,2,3)),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE INDEX task_templates_created ON task_templates(created_at DESC,id DESC);
        CREATE TABLE collections(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,url TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE INDEX collections_created ON collections(created_at DESC,id DESC);
      `);
    },
  },
  {
    version: 7,
    up: async tx => {
      await tx.exec(`
        ALTER TABLE collections ADD COLUMN kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','link','account'));
        ALTER TABLE collections ADD COLUMN account TEXT NOT NULL DEFAULT '';
        ALTER TABLE collections ADD COLUMN password TEXT NOT NULL DEFAULT '';
        UPDATE collections SET kind=CASE WHEN length(trim(url))>0 THEN 'link' ELSE 'text' END;
      `);
    },
  },
  {
    version: 8,
    up: async tx => {
      await tx.exec(`
        ALTER TABLE ideas ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1));
        ALTER TABLE ideas ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));
        CREATE INDEX ideas_management ON ideas(archived,pinned DESC,created_at DESC,id DESC);
      `);
    },
  },
];

/** Deterministic conversion also runs after restoring a pre-v4 backup. Original rows stay intact. */
export async function migrateLegacyAi(tx: SqlExecutor): Promise<void> {
  await tx.exec(`
    INSERT OR IGNORE INTO ai_conversations SELECT 'legacy_'||id,'food',NULL,snapshot,refs,'food-legacy-v1',created_at FROM ai_sessions;
    INSERT OR IGNORE INTO ai_messages SELECT 'legacy_user_'||id,'legacy_'||id,'user',question,json_object('provider','deepseek','model',model),NULL,'success',NULL,created_at,1 FROM ai_sessions;
    INSERT OR IGNORE INTO ai_messages SELECT 'legacy_assistant_'||id,'legacy_'||id,'assistant',COALESCE(answer,''),json_object('provider','deepseek','model',model),NULL,status,error,created_at,2 FROM ai_sessions;
  `);
}

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function schemaVersion(db: SqlDb): Promise<number> {
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/** Applies pending migrations, each inside its own exclusive transaction. */
export async function migrate(db: SqlDb): Promise<number> {
  await db.exec('PRAGMA foreign_keys = ON');
  const current = await schemaVersion(db);
  if (current > SCHEMA_VERSION) throw new Error(`数据库版本 ${current} 高于当前应用支持的版本 ${SCHEMA_VERSION}，请更新应用。`);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.transaction(async (tx) => {
      await m.up(tx);
      await tx.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return schemaVersion(db);
}
