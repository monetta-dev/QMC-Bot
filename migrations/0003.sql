CREATE TABLE IF NOT EXISTS publication_images (
 publication_id TEXT PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE,
 token TEXT NOT NULL UNIQUE,
 png BLOB NOT NULL
);
