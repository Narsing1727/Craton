-- A larger installation, made of generated rows: 3,000 people, 40 organizations, 20,000 repositories (one has 50,000 issues), 400,000 issues,
-- 800,000 comments, 300,000 stars, 400,000 audit rows, 200,000 commits in one repository.
SET synchronous_commit = off;
INSERT INTO owners (handle, kind, name, bio) SELECT 'user' || g, 'user', 'Person ' || g, 'Hydrologist number ' || g FROM generate_series(1, 3000) g;
INSERT INTO users (owner_id, email, password_hash, email_verified_at) SELECT o.id, o.handle || '@example.org', 'x', now_iso() FROM owners o WHERE o.kind = 'user';
INSERT INTO owners (handle, kind, name, bio) SELECT 'org' || g, 'org', 'Organization ' || g, '' FROM generate_series(1, 40) g;
INSERT INTO memberships (org_id, user_id, role) SELECT o.id, u.id, CASE WHEN u.n % 50 = 0 THEN 'Owner' ELSE 'Member' END
  FROM (SELECT id FROM owners WHERE kind = 'org') o CROSS JOIN LATERAL (SELECT id, row_number() OVER () AS n FROM owners WHERE kind = 'user' ORDER BY id LIMIT 400) u;
INSERT INTO repos (owner_id, name, description, visibility, stars, tags, topics, updated_at)
  SELECT (SELECT id FROM owners WHERE handle = 'user' || (1 + g % 3000)), 'basin-' || g, 'Flood model for catchment ' || g || ' of the river basin study', CASE WHEN g % 10 = 0 THEN 'private' ELSE 'public' END,
         (g * 7919) % 500, '["flood","dem"]', '["hydrology","raster"]', to_char(now() - (g || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
  FROM generate_series(1, 20000) g;
INSERT INTO stars (user_id, repo_id) SELECT DISTINCT ((r.id * 31 + k) % 3000) + 1, r.id FROM repos r, generate_series(1, 15) k;
INSERT INTO issues (repo_id, number, title, body, author_id, state, label, updated_at)
  SELECT r.id, g, 'Issue ' || g || ' gauge reads high', 'Body of issue ' || g, 1 + (g % 3000), CASE WHEN g % 3 = 0 THEN 'closed' ELSE 'open' END, 'question',
         to_char(now() - (g || ' seconds')::interval, 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
  FROM (SELECT id FROM repos WHERE name = 'basin-1') r, generate_series(1, 50000) g;
INSERT INTO issues (repo_id, number, title, body, author_id, state, label, updated_at)
  SELECT r.id, g, 'Issue ' || g, '', 1 + (g % 3000), 'open', 'bug', now_iso()
  FROM (SELECT id FROM repos WHERE id % 20 = 2 LIMIT 3500) r, generate_series(1, 100) g;
INSERT INTO comments (repo_id, target, number, author_id, body)
  SELECT r.id, 'issue', 1 + (g % 50000), 1 + (g % 3000), 'comment ' || g FROM (SELECT id FROM repos WHERE name = 'basin-1') r, generate_series(1, 300000) g;
INSERT INTO audit_events (owner_id, owner_handle, repo, actor_id, actor_handle, action, method, route, status, ip)
  SELECT 3001 + (g % 40), 'org' || (1 + g % 40), 'basin-' || (1 + g % 500), 1 + (g % 3000), 'user' || (1 + g % 3000), 'POST /x', 'POST', '/repos/:owner/:repo/issues', 201, '10.0.0.1' FROM generate_series(1, 400000) g;
INSERT INTO commits (repo_id, id, tree, parents, author, message, timestamp, merkle_root)
  SELECT r.id, md5(g::text) || md5((g + 1)::text), md5('t' || g), '[]', 'user' || (1 + g % 3000), 'Commit number ' || g, to_char(now() - (g || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'), md5('m' || g)
  FROM (SELECT id FROM repos WHERE name = 'basin-1') r, generate_series(1, 200000) g;
ANALYZE;
SELECT (SELECT count(*) FROM repos) repos, (SELECT count(*) FROM issues) issues, (SELECT count(*) FROM comments) comments, (SELECT count(*) FROM stars) stars, (SELECT count(*) FROM audit_events) audit, (SELECT count(*) FROM commits) commits;
