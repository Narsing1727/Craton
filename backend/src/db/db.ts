// SQLite (Node's built-in node:sqlite) with versioned migrations.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const migrations: string[] = [
  /* 1: accounts, repositories, content-addressed storage, history */ `
  CREATE TABLE owners (
    id INTEGER PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL CHECK (kind IN ('user','org')),
    name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE users (
    owner_id INTEGER PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free'
  );
  CREATE TABLE memberships (
    org_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Owner','Maintainer','Member')),
    PRIMARY KEY (org_id, user_id)
  );
  CREATE TABLE tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('session','pat')),
    note TEXT NOT NULL DEFAULT '',
    scopes TEXT NOT NULL DEFAULT 'repo',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT,
    last_used_at TEXT
  );
  CREATE TABLE repos (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL CHECK (visibility IN ('public','private')),
    default_branch TEXT NOT NULL DEFAULT 'main',
    region TEXT NOT NULL DEFAULT '',
    crs TEXT NOT NULL DEFAULT 'EPSG:32643',
    nodata REAL,
    vertical_datum INTEGER,
    require_checks INTEGER NOT NULL DEFAULT 1,
    require_review INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL DEFAULT 0,
    forks INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    forked_from INTEGER REFERENCES repos(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (owner_id, name)
  );
  CREATE TABLE collaborators (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Admin','Write','Triage','Read')),
    PRIMARY KEY (repo_id, user_id)
  );

  -- Physical chunks, stored once by hash.
  CREATE TABLE chunks (
    hash TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    stored_size INTEGER NOT NULL,
    codec TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  -- Who may reference a chunk: 'public' or 'owner:<id>' (DECISIONS.md #3).
  CREATE TABLE chunk_scopes (
    hash TEXT NOT NULL REFERENCES chunks(hash),
    scope TEXT NOT NULL,
    PRIMARY KEY (hash, scope)
  );

  CREATE TABLE objects (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('blob','tree','commit')),
    body TEXT NOT NULL
  );
  CREATE TABLE repo_objects (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    object_id TEXT NOT NULL REFERENCES objects(id),
    PRIMARY KEY (repo_id, object_id)
  );
  -- Which repository references which chunk (for storage and dedup statistics).
  CREATE TABLE repo_chunks (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    PRIMARY KEY (repo_id, hash)
  );
  CREATE INDEX idx_repo_chunks_hash ON repo_chunks(hash);
  CREATE TABLE commits (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    tree TEXT NOT NULL,
    parents TEXT NOT NULL,
    author TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    PRIMARY KEY (repo_id, id)
  );
  CREATE TABLE refs (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('branch','tag')),
    name TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (repo_id, kind, name)
  );
  -- Append-only record of every ref change (audit trail).
  CREATE TABLE ref_log (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL,
    ref TEXT NOT NULL,
    old_commit TEXT,
    new_commit TEXT,
    actor TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
  /* 2: collaboration */ `
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    author_id INTEGER NOT NULL REFERENCES owners(id),
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
    label TEXT NOT NULL DEFAULT 'question',
    assignee_id INTEGER REFERENCES owners(id),
    milestone TEXT,
    file_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (repo_id, number)
  );
  CREATE TABLE pulls (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    author_id INTEGER NOT NULL REFERENCES owners(id),
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','merged','closed')),
    merged_commit TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (repo_id, number)
  );
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    target TEXT NOT NULL CHECK (target IN ('issue','pull')),
    number INTEGER NOT NULL,
    author_id INTEGER NOT NULL REFERENCES owners(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    author_id INTEGER NOT NULL REFERENCES owners(id),
    state TEXT NOT NULL CHECK (state IN ('approved','changes_requested','commented')),
    body TEXT NOT NULL DEFAULT '',
    commit_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE check_runs (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    commit_id TEXT NOT NULL,
    branch TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('passed','failed')),
    steps TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE releases (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    prerelease INTEGER NOT NULL DEFAULT 0,
    merkle_root TEXT NOT NULL,
    checksums TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES owners(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (repo_id, tag)
  );
  CREATE INDEX idx_commits_repo_time ON commits(repo_id, timestamp DESC);
  CREATE INDEX idx_checks_repo ON check_runs(repo_id, created_at DESC);
  `,
  /* 3: onboarding and password resets */ `
  ALTER TABLE users ADD COLUMN role TEXT;
  ALTER TABLE users ADD COLUMN onboarded_at TEXT;
  -- How a branch moved: 'push' (the push endpoint / CLI), 'merge' or 'branch' (created in the app).
  ALTER TABLE ref_log ADD COLUMN via TEXT;
  CREATE TABLE password_resets (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  `,
  /* 4: stars, email verification, session details, health history */ `
  CREATE TABLE stars (
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (user_id, repo_id)
  );
  -- repos.stars becomes a count kept in step with this table (it held made-up demo numbers).
  UPDATE repos SET stars = 0, forks = 0;
  ALTER TABLE users ADD COLUMN email_verified_at TEXT;
  CREATE TABLE email_tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  ALTER TABLE tokens ADD COLUMN user_agent TEXT;
  ALTER TABLE tokens ADD COLUMN ip TEXT;
  CREATE TABLE health_samples (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    component TEXT NOT NULL,
    ok INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL
  );
  CREATE INDEX health_samples_at ON health_samples (component, at);
  `,
  /* 5: dataset card (licence, topics) and file locks */ `
  ALTER TABLE repos ADD COLUMN license TEXT NOT NULL DEFAULT '';
  ALTER TABLE repos ADD COLUMN topics TEXT NOT NULL DEFAULT '[]';
  -- One holder per path. Locks are advisory for reading and enforced when a branch moves.
  CREATE TABLE file_locks (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (repo_id, path)
  );
  `,
  /* 6: webhooks and their delivery log */ `
  CREATE TABLE webhooks (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES owners(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_webhooks_repo ON webhooks(repo_id);
  CREATE TABLE webhook_deliveries (
    id INTEGER PRIMARY KEY,
    webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    message_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed')),
    response_code INTEGER,
    error TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    delivered_at TEXT
  );
  CREATE INDEX idx_deliveries_due ON webhook_deliveries(status, next_attempt_at);
  CREATE INDEX idx_deliveries_hook ON webhook_deliveries(webhook_id, id DESC);
  `,
  /* 7: two-step verification (authenticator app + recovery codes) */ `
  -- The secrets are AES-GCM ciphertext (services/secrets.ts), never the plain base32.
  ALTER TABLE users ADD COLUMN totp_secret TEXT;
  ALTER TABLE users ADD COLUMN totp_pending TEXT;
  ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;
  ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    UNIQUE (user_id, code_hash)
  );
  -- Between a correct password and a correct code: single-use, short-lived, attempt-limited.
  CREATE TABLE mfa_tickets (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    ticket_hash TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL
  );
  `,
  /* 8: share links (read-only snapshots for people without an account) */ `
  -- Only the hash of the token is kept: the address is shown once, when the link is made.
  CREATE TABLE share_links (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES owners(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used_at TEXT,
    uses INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_share_repo ON share_links(repo_id, id DESC);
  `,
  /* 9: where the data is (footprints) */ `
  -- [west, south, east, north] in degrees around every located file on the default branch.
  ALTER TABLE repos ADD COLUMN footprint TEXT;
  ALTER TABLE repos ADD COLUMN footprint_at TEXT;
  -- One row per file version: its longitude/latitude box, or NULLs for "no usable location".
  CREATE TABLE blob_extents (
    key TEXT PRIMARY KEY,
    west REAL, south REAL, east REAL, north REAL
  );
  `,
  /* 10: server-side inbox state */ `
  -- Items before this count as read (set the first time someone has an inbox, and by "mark all as read").
  ALTER TABLE users ADD COLUMN inbox_read_before TEXT;
  -- A person's own marks on inbox items; the items themselves are derived from the activity feed.
  CREATE TABLE inbox_state (
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('read','unread','done')),
    at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  `,
  /* 11: ref_log had no foreign key, so deleting a repository left its history behind, and SQLite
        reuses the id: the next repository created inherited that history (a private repository's
        commit messages showed up in a new repository's activity). */ `
  DELETE FROM ref_log WHERE repo_id NOT IN (SELECT id FROM repos);
  CREATE TRIGGER ref_log_with_repo AFTER DELETE ON repos BEGIN
    DELETE FROM ref_log WHERE repo_id = OLD.id;
  END;
  `,
  /* 12: milestones are real records now (the new-issue form used to offer two invented ones in every
        repository); milestones already named on issues are kept. */ `
  CREATE TABLE milestones (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    title TEXT NOT NULL COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    due TEXT,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (repo_id, title)
  );
  INSERT OR IGNORE INTO milestones (repo_id, title) SELECT DISTINCT repo_id, milestone FROM issues WHERE milestone IS NOT NULL AND TRIM(milestone) <> '';
  `,/* 13: the status page and its uptime samples are gone. */ `
  DROP TABLE IF EXISTS health_samples;
  `,/* 14: a person's own security activity (sign-ins, password and token changes, two-step verification). */ `
  CREATE TABLE security_events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_security_events_user ON security_events (user_id, id DESC);
  `,/* 15: path patterns that must be locked before they can be changed. */ `
  ALTER TABLE repos ADD COLUMN lock_patterns TEXT NOT NULL DEFAULT '[]';
  `,/* 16: a personal access token can be limited to named repositories (JSON array of "owner/name", NULL = all). */ `
  ALTER TABLE tokens ADD COLUMN repos TEXT;
  `,/* 17: a person's saved issue and pull request filters. */ `
  CREATE TABLE saved_filters (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('issues','pulls')),
    name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    q TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (user_id, kind, name)
  );
  `,/* 18: invitations to a repository sent to an email address that has no account yet. */ `
  CREATE TABLE repo_invites (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('Read','Write','Admin')),
    token_hash TEXT NOT NULL UNIQUE,
    invited_by INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    UNIQUE (repo_id, email)
  );
  `,/* 19: asking a specific person to review a pull request. */ `
  CREATE TABLE review_requests (
    id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    requested_by INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (repo_id, number, user_id)
  );
  `,/* 20: merging needs an approval from the code owner of every changed file. */ `
  ALTER TABLE repos ADD COLUMN require_owner_review INTEGER NOT NULL DEFAULT 0;
  `,/* 21: storage-limit warnings already sent (one per owner and threshold, cleared when usage falls back below it). */ `
  CREATE TABLE plan_notices (
    owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    threshold INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (owner_id, threshold)
  );
  `,/* 22: why a webhook was paused by Craton itself (ten failed deliveries in a row); NULL when active or paused by a person. */ `
  ALTER TABLE webhooks ADD COLUMN paused_reason TEXT;
  `,
];

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  for (; version < migrations.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(migrations[version]);
      db.prepare("UPDATE schema_version SET version = ?").run(version + 1);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}

/** Run `fn` in a transaction; rolls back on any error. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
