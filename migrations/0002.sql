CREATE TABLE IF NOT EXISTS line_groups (
 group_id TEXT PRIMARY KEY,
 active INTEGER NOT NULL CHECK(active IN (0, 1)),
 event_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO line_groups(group_id,active,event_at)
 SELECT json_extract(value,'$.id'),COALESCE(json_extract(value,'$.active'),0),COALESCE(json_extract(value,'$.eventAt'),0)
 FROM app_settings WHERE key='group' AND json_extract(value,'$.id') IS NOT NULL;
