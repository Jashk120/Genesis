-- Slice 1: named snapshot CRUD foundation (additive).
-- Reserves the delta-chain upgrade path; v1 always writes full blobs.

ALTER TABLE snapshot
  ADD COLUMN seq INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN workspace_id UUID REFERENCES workspace(id) ON DELETE CASCADE,
  ADD COLUMN scope_page_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN byte_size INTEGER,
  ADD COLUMN block_count INTEGER,
  ADD COLUMN base_snapshot_id UUID REFERENCES snapshot(id) ON DELETE SET NULL,
  ADD COLUMN delta JSONB,
  ADD COLUMN is_materialized BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill workspace_id from the source page, then tighten.
UPDATE snapshot s SET workspace_id = p.workspace_id
  FROM page p WHERE p.id = s.source_page_id;
ALTER TABLE snapshot ALTER COLUMN workspace_id SET NOT NULL;

CREATE UNIQUE INDEX snapshot_source_label_uidx ON snapshot (source_page_id, label);
CREATE UNIQUE INDEX snapshot_source_seq_uidx   ON snapshot (source_page_id, seq);
CREATE INDEX snapshot_workspace_idx            ON snapshot (workspace_id);

-- TRAP FIX 1: 001 declared source_page_id ON DELETE CASCADE, which would
-- delete all history when a live page is deleted. History must survive page
-- deletion attempts, so the FK is RESTRICT: deleting a snapshotted page
-- errors unless its history is handled first.
ALTER TABLE snapshot DROP CONSTRAINT snapshot_source_page_id_fkey;
ALTER TABLE snapshot ADD CONSTRAINT snapshot_source_page_id_fkey
  FOREIGN KEY (source_page_id) REFERENCES page(id) ON DELETE RESTRICT;

-- TRAP FIX 2: history must survive page moves and be workspace-scoped.
-- workspace_id above (CASCADE from workspace, backfilled from the source
-- page) keeps snapshots queryable per workspace even if the source page
-- is moved or deleted.
