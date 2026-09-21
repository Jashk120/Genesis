-- Genesis v1 schema: 11 tables.
-- Documents + snapshots first, then the semantic layer.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. workspace: isolation boundary, one novel/container each.
CREATE TABLE workspace (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. page: navigable cluster. kind = folder|story|version|chapter|note.
CREATE TABLE page (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    parent_page_id UUID REFERENCES page(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('folder','story','version','chapter','note')),
    title TEXT NOT NULL DEFAULT '',
    discourse_index INTEGER,
    narrative_order INTEGER,
    ordinal INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX page_workspace_idx ON page (workspace_id);
CREATE INDEX page_parent_idx ON page (parent_page_id);

-- 3. block: one row per block; data carries { "delta": [...], ... }.
CREATE TABLE block (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    parent_block_id UUID REFERENCES block(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{"delta": []}',
    ordinal INTEGER NOT NULL DEFAULT 0,
    -- Container blocks (lists, blockquotes) carry children, not a delta, so
    -- require only that data is an object; `delta` is validated in the domain.
    CONSTRAINT block_data_is_object CHECK (jsonb_typeof(data) = 'object')
);
CREATE INDEX block_page_idx ON block (page_id);
CREATE INDEX block_parent_idx ON block (parent_block_id);

-- 4. snapshot: immutable frozen copy of a story's block tree.
CREATE TABLE snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_page_id UUID NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    content JSONB NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX snapshot_source_idx ON snapshot (source_page_id);

-- 5. entity: character | place | object | faction | concept.
CREATE TABLE entity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    canonical_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('character','place','object','faction','concept')),
    merged_into_id UUID REFERENCES entity(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX entity_workspace_idx ON entity (workspace_id);
CREATE INDEX entity_merged_idx ON entity (merged_into_id);

-- 6. entity_alias: surface forms for @-mention completion.
CREATE TABLE entity_alias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    surface_form TEXT NOT NULL,
    alias_kind TEXT NOT NULL CHECK (alias_kind IN ('name','title','nickname')),
    UNIQUE (entity_id, surface_form)
);
CREATE INDEX entity_alias_entity_idx ON entity_alias (entity_id);

-- 7. entity_lineage: audit record for merge/split.
CREATE TABLE entity_lineage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    to_entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('merge','split')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. mention: durable text-span -> entity binding. NULL entity_id = unresolved.
CREATE TABLE mention (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID REFERENCES entity(id) ON DELETE SET NULL,
    block_id UUID NOT NULL REFERENCES block(id) ON DELETE CASCADE,
    span_start INTEGER NOT NULL CHECK (span_start >= 0),
    span_end INTEGER NOT NULL CHECK (span_end >= span_start),
    surface_form TEXT NOT NULL,
    resolution TEXT CHECK (resolution IN ('manual','auto_exact','auto_alias')),
    confidence DOUBLE PRECISION,
    provenance JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mention_block_idx ON mention (block_id);
CREATE INDEX mention_entity_idx ON mention (entity_id);

-- 9. field_def: registry so extraction and annotation agree on field names.
CREATE TABLE field_def (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    field_key TEXT NOT NULL,
    value_type TEXT NOT NULL CHECK (value_type IN ('enum','string','number','boolean','entity_ref')),
    cardinality TEXT NOT NULL CHECK (cardinality IN ('scalar','keyed_set')),
    enum_values JSONB,
    applies_to JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
    successor_field_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, field_key)
);

-- 10. claim: append-only versioned facts grouped by (entity_id, field_key, claim_key).
-- claim_key: "_" for scalar, member key for keyed_set, note block id for free-text notes.
-- field_key NULL only for free-text notes.
CREATE TABLE claim (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    -- Logical FK -> field_def(field_key) within the same workspace; not a hard
    -- DB FK because field_def uniqueness is scoped per workspace.
    field_key TEXT,
    claim_key TEXT NOT NULL,
    value JSONB NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('authored','extracted')),
    source_location JSONB NOT NULL,
    mention_id UUID REFERENCES mention(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'asserted'
        CHECK (status IN ('asserted','superseded','retracted')),
    supersedes_id UUID REFERENCES claim(id) ON DELETE SET NULL,
    change_kind TEXT NOT NULL DEFAULT 'addition'
        CHECK (change_kind IN ('addition','correction','in_story_change','retraction','unknown')),
    confidence DOUBLE PRECISION,
    verified TEXT NOT NULL DEFAULT 'unverified'
        CHECK (verified IN ('unverified','confirmed','rejected')),
    extraction_meta JSONB,
    discourse_seq BIGINT NOT NULL,
    narrative_order INTEGER,
    version INTEGER NOT NULL CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Per-chain version uniqueness, NULL-safe on field_key.
CREATE UNIQUE INDEX claim_chain_version_uidx
    ON claim (entity_id, COALESCE(field_key, '__free_note__'), claim_key, version);
CREATE INDEX claim_entity_idx ON claim (entity_id);
CREATE INDEX claim_head_lookup_idx
    ON claim (entity_id, COALESCE(field_key, '__free_note__'), claim_key, version DESC);

-- 11. conflict: separate reviewable record, never a mutated claim.
-- Unique on (prior_claim_id, new_claim_id, tier): re-runs never duplicate.
CREATE TABLE conflict (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    field_key TEXT,
    claim_key TEXT,
    prior_claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
    new_claim_id UUID NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('t1_structured','t2_extracted','t3_soft')),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','suggested','dismissed','resolved_as_change','resolved_as_correction')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (prior_claim_id, new_claim_id, tier)
);
CREATE INDEX conflict_entity_idx ON conflict (entity_id);
