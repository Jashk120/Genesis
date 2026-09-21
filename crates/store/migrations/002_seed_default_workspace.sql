-- Seed a default workspace so a fresh install is immediately usable.
-- Idempotent: re-running never duplicates.
INSERT INTO workspace (id, title)
VALUES ('00000000-0000-0000-0000-000000000001', 'My Novel')
ON CONFLICT (id) DO NOTHING;
