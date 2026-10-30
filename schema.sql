-- Nihor2 Tracker database (Turso / libSQL)
-- Shared data that the Control Panel edits and every visitor reads.
-- Per-visitor things (material prices, picked levels, theme, scaling) stay in the browser.

-- Upgrade Cost items: one row per item in a category
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL CHECK (category IN ('weapons','jewellery','armour','helmets','shields')),
  name        TEXT    NOT NULL,
  image       TEXT,                          -- uploaded picture (data URL); NULL = png/<slug>.png
  craft_yang  INTEGER NOT NULL DEFAULT 0,    -- Yang for the craft step (+9 of the previous item -> +0)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (category, name COLLATE NOCASE)
);

-- Yang per upgrade step; step 0 = +0 -> +1 ... step 8 = +8 -> +9
CREATE TABLE IF NOT EXISTS item_steps (
  item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  step     INTEGER NOT NULL CHECK (step BETWEEN 0 AND 8),
  yang     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, step)
);

-- Materials per step; step -1 = craft
CREATE TABLE IF NOT EXISTS item_materials (
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  step      INTEGER NOT NULL CHECK (step BETWEEN -1 AND 8),
  material  TEXT    NOT NULL,
  count     INTEGER NOT NULL CHECK (count > 0),
  position  INTEGER NOT NULL DEFAULT 0,      -- display order of the material in the row
  PRIMARY KEY (item_id, step, material)
);

-- Stats shown at each level (Attack Value, Strong against Monsters ...); level 0..9 = +0..+9
CREATE TABLE IF NOT EXISTS item_stats (
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  stat      TEXT    NOT NULL,
  level     INTEGER NOT NULL CHECK (level BETWEEN 0 AND 9),
  value     TEXT    NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, stat, level)
);

-- Skill Booster: cost of going from a level to the next; level 0..29 = M1..M10, G1..G10, P1..P10
CREATE TABLE IF NOT EXISTS skill_levels (
  level  INTEGER PRIMARY KEY CHECK (level BETWEEN 0 AND 29),
  yang   INTEGER NOT NULL DEFAULT 0
);

-- Materials per skill level; "Skillbook M-G" / "Skillbook G-P" become the picked skill's own book
CREATE TABLE IF NOT EXISTS skill_materials (
  level     INTEGER NOT NULL REFERENCES skill_levels(level) ON DELETE CASCADE,
  material  TEXT    NOT NULL,
  count     INTEGER NOT NULL CHECK (count > 0),
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (level, material)
);

-- Skill books assigned to each character group (Control Panel -> Skill Booster)
CREATE TABLE IF NOT EXISTS character_skills (
  character  TEXT    NOT NULL CHECK (character IN ('warrior','sura','ninja','shaman')),
  grp        TEXT    NOT NULL,               -- body/mental, wasu/masu, dagger/archer, dragon/heal
  skill      TEXT    NOT NULL,               -- the [M-G] book name, e.g. "Sword Spin Skill Book [M-G]"
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character, grp, skill)
);

CREATE INDEX IF NOT EXISTS items_by_category ON items(category);

-- Small key/value facts; 'updated' = when the Control Panel last saved anything (main page "Last updated")
CREATE TABLE IF NOT EXISTS meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
