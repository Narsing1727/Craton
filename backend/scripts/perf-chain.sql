-- Turn the 200,000 loose commits of basin-1 into one linear history, oldest first, with main at the newest.
WITH r AS (SELECT id FROM repos WHERE name = 'basin-1'),
ordered AS (SELECT c.repo_id, c.id, lag(c.id) OVER (ORDER BY c.timestamp ASC, c.id) AS prev FROM commits c, r WHERE c.repo_id = r.id)
UPDATE commits c SET parents = CASE WHEN o.prev IS NULL THEN '[]' ELSE '["' || o.prev || '"]' END FROM ordered o WHERE c.repo_id = o.repo_id AND c.id = o.id;
INSERT INTO refs (repo_id, kind, name, commit_id) SELECT r.id, 'branch', 'main', (SELECT id FROM commits WHERE repo_id = r.id ORDER BY timestamp DESC LIMIT 1) FROM repos r WHERE r.name = 'basin-1' ON CONFLICT DO NOTHING;
ANALYZE commits;
