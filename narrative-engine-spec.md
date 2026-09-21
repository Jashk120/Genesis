# Genesis — Spec (v2 draft)

Genesis is a Notion-like writing app for novelists with an embedded semantic layer that tracks characters, facts, and their evolution across a manuscript. BYOK for any LLM-backed features.

> **Revision note.** This draft corrects the v1 storage model so v2 (contradiction detection) needs **no migration**. The original `Claim { entity_id, field, value, ... }` tuple was under-specified in six ways that each force a schema change later: scalar-vs-set fields, deletions/retractions, correction-vs-plot-change, verification/confirmation state, extraction provenance, and entity identity. Later rounds closed the remaining holes (`Chapter`/`Block`, free-note chains, the current-state predicate, cross-key corrections, registry/mention provenance) and settled four product decisions: the **document format is a delta-based block tree, not markdown**; the **page tree is workspace → pages → blocks**; **story versions are immutable snapshots**; and **workspaces (isolation) and database views (entity tables) are separate layers, both in scope**. See the [Changelog vs. v1](#changelog-vs-v1). The near-term scope (v1) is **unchanged** — still deterministic, still AI-free. Only the durable schema and the build order moved.

---

## What this is not

- Not a generic "Notion for novelists" — the differentiator is the semantic model (versioned, sourced claims), not the editor UI.
- Not LSP-protocol-based. Originally conceived as an LSP-style server, but since this is a single embedded app (not multi-editor tooling), we skip protocol compliance and build the feature directly.
- Not fully LLM-free — one narrow extraction task uses a small model. Everything else (storage, versioning, structured contradiction checks) is deterministic.
- Not an automatic-linking or coreference system in v1. Prose mentions are **manually linked** by the writer in v1; automatic resolution is v2+ (see [Entity mentions](#3-entity-mentions) and [The hard problem](#the-hard-problem-entity-mention-resolution)).
- Not a CRDT app in v1. There is no collaboration or offline multi-device sync yet, so there is no CRDT — documents are stored as rows, and a CRDT layer is added later without a rewrite (see [Storage](#storage)). Do **not** copy AppFlowy's full stack for this scope.
- Not markdown-based. The document is a typed block tree whose text is a `delta` array; markdown is an export target only.

---

## Document model

The address space has three levels: **workspace → page tree → block tree**. Every claim and mention points at a block.

### Workspace — the isolation boundary

```
Workspace {
  workspace_id
  title
  created_at
}
```

A workspace is one novel/container. Pages, entities, claims, and fields never cross workspaces — "Alice" in Novel A is unrelated to "Alice" in Novel B. v1 creates a default workspace; a switcher UI is deferred. This is separate from [database views](#workspaces-vs-database-views): workspaces *isolate*, database views *display*.

### Pages — the navigable cluster

```
Page {
  page_id
  workspace_id
  parent_page_id   // nullable; NULL = top-level page (a root cluster)
  kind             // folder | story | version | chapter | note
  title
  discourse_index  // nullable; reading order among siblings
  narrative_order  // nullable int; story-time sequence, used by the claim clock
  ordinal          // order among siblings
  created_at
}
```

Pages form a tree: the root page lists its child pages, and clicking one navigates into it. The intended shape for a novel:

```
Root (folder)
└── Story 1 (story)
    ├── v1 (version)   → frozen snapshot, view-only
    └── v2 (version)   → frozen snapshot, view-only
        ├── Chapter 1 (chapter)
        └── Chapter 2 (chapter)
```

A `chapter` page holds prose blocks and owns `narrative_order`. A `version` page is a **frozen snapshot** (see [Snapshots](#snapshots-story-versions)). A `folder` is a plain grouping page. `note` is a free-standing annotation page.

### Blocks — the document body

A page's body is a tree of typed blocks; text lives in a `delta` array (Quill-style inserts), **not markdown**.

```
Block {
  block_id          // stable, opaque (uuid). Assigned on creation. NEVER reused.
  page_id           // FK -> Page
  parent_block_id   // nullable; nested children (the page's root block is type: page)
  type              // page | heading | paragraph | bulleted_list_item | annotation | ...
  data              // JSON: { "delta": [{"insert":"..."}], "level": 1, ... }
  ordinal           // order among siblings; mutable, ordering only
}
```

This is the canonical serialization. A page assembles to exactly:

```json
{
  "type": "page",
  "children": [
    { "type": "heading", "data": { "delta": [{ "insert": "My Novel" }], "level": 1 } },
    { "type": "paragraph", "data": { "delta": [{ "insert": "The door opened." }] } }
  ]
}
```

Read = assemble `Block` rows into this tree; write = flatten it back. **Storage is normalized per block, not one blob per page** (snapshots are the exception). Block IDs are stored as a `blockId` attribute on the corresponding editor node so the editor and the store share one identifier.

### Document format and the editor

- **Canonical format:** the delta block tree above. It is version-stable and editor-agnostic.
- **Editor:** Tiptap (ProseMirror). Tiptap does **not** emit delta; it emits ProseMirror JSON (also a typed node tree, but text as text-nodes + marks). Therefore a **mapper translates between the canonical delta tree and Tiptap's ProseMirror doc on load/save**.
- The mapper is bounded but not free: simple text/marks are direct, nested content and exotic marks need explicit rules. It is a named dependency in the build order, with round-trip tests.
- **Markdown is export-only.** There is no markdown import path in v1.

### Block ID stability rules

This is what makes "sourced to its chapter" meaningful:

- A `block_id` survives text edits, moves between pages, and reordering. It is the identity of the block, not its position.
- **Splitting** a block (Enter mid-paragraph) keeps the original `block_id` on the left half and mints a new one for the right. Claims pointing at the original stay valid.
- **Merging** blocks (Backspace at a boundary) keeps the first block's `block_id`; the second's id is tombstoned and all claims/mentions on it are re-pointed to the survivor as new `SourceLocation`s, recorded as a `source_migrated` event. No claim is silently orphaned.
- Deleting a block writes `status: retracted` claims (never deletes rows) and leaves mentions with `entity_id = null` (unresolved).

`SourceLocation` = `{ block_id, span_start, span_end, page_id }`, where `page_id` is denormalized from the block for grouping. **Spans are not stable across edits.** The block ID is the durable anchor; the span is a best-effort pointer that is recomputed or marked stale. For a delta block, `span_start`/`span_end` are character offsets across the block's delta (the running sum of `insert` lengths).

### Snapshots (story versions)

A `version` page is an **immutable snapshot**: a frozen copy of a story's pages/blocks at a point in time. It is view-only — editing never happens in a version page; the live draft is separate.

```
Snapshot {
  snapshot_id
  source_page_id   // the live story page this froze
  label            // "v1", "v2", ...
  content          // JSON: the frozen block tree. A blob is CORRECT here — immutable, written once.
  content_hash     // dedupe / change detection
  created_at
}
```

Snapshots are the one place a whole-document blob is right: they are append-only and never edited, so the "row-per-block" rule (which exists to avoid rewrites on keystroke) does not apply. Diffing two versions is a later feature; v1 only needs to create, list, and view them.

---

## Core data model

Two separate capture paths feed the same underlying entity store:

### 1. Prose → structured fact (automatic, small-model extraction) — v2

Writer writes normally: *"Her eyes were blue."*
A small local extraction model (not a generative LLM) pulls this into a structured claim: `eyes: blue`, tagged with a source location and `source_type: extracted`.

### 2. Annotation block → author's meta-notes (manual, writer-authored) — v1

Writer adds an explicit annotation block near a character/entity (a `Block` of `type: annotation`) — visually separated from prose, **never rendered in the draft itself**. Used for:
- Facts the writer wants to declare directly, structured (`family.son: alice`)
- Planning notes / undecided intent ("this character will become a traitor later") — free text, not extracted, stored as-is against the entity

Tagged `source_type: authored`.

> **Naming:** the original doc called these "docstrings". That overloads a programming term for a block of manuscript-adjacent metadata. This draft uses *annotation block* throughout.

Both paths write into the **same versioned-claims table** — keeps hover, versioning, and (later) contradiction logic uniform instead of duplicated.

---

## Entities and identity

A bare `entity_id` on a claim assumes identity is already solved. It isn't — the same character is *"King"*, *"the King"*, *"Robert"*, and *"her"*. Model it explicitly:

```
Entity {
  entity_id
  workspace_id    // isolation boundary
  canonical_name
  kind            // character | place | object | faction | concept
  merged_into_id  // nullable; set when this entity is merged into another
  created_at
}

EntityAlias {
  alias_id
  entity_id
  surface_form    // "King", "Robert", "the old king"
  alias_kind      // name | title | nickname
}

EntityLineage {   // audit record for merge/split; merged_into_id is the fast lookup
  lineage_id
  from_entity_id
  to_entity_id
  kind            // merge | split
  note            // nullable free text
  created_at
}
```

- **Merge** is a non-destructive pointer (`merged_into_id`); the original entity is retained. **Query rule:** all reads follow `merged_into_id` transitively, so a claim on a merged-away entity resolves to the survivor without rewriting history.
- **Split** creates a new entity (`EntityLineage { kind: split }`) and re-points the relevant claims to it — recorded, not deleted.
- Aliases exist in v1 because manual linking is far less tedious when the writer can type `@King` and get `Robert`.

### 3. Entity mentions

Hover/inspector needs text spans bound to entities. A mention is its own durable record — not just an editor decoration — so v2 extraction can create mentions that have no editor node yet.

```
Mention {
  mention_id
  entity_id       // nullable; NULL means unresolved
  block_id
  span_start
  span_end
  surface_form
  resolution      // manual | auto_exact | auto_alias   (null entity_id => unresolved)
  confidence      // nullable; set for auto_* resolvers
  provenance      // nullable JSON: matcher_id, model_version
  created_at
}
```

`entity_id = null` **is** the "unresolved" state — there is no separate `unresolved` enum member (avoids double-encoding). In v1 the editor's entity-mention node carries `mention_id`; the node is a view over the record, not the source of truth. Automatic resolution is v2+ and writes `resolution != manual` with `confidence`/`provenance`; the schema does not change.

---

## Workspaces vs. database views

These are **orthogonal**, not competing — a user sees them as "the same" only in a trivial one-book case.

- **Workspace = isolation.** A hard tenancy boundary. Data never crosses workspaces. "Novel A" and "Novel B" are separate worlds. Cost: a `workspace_id` column on every top-level table plus a switcher UI. Add it **now**, because retrofitting isolation later is a painful migration.
- **Database view = display.** A Notion-style table over the *existing* semantic layer: rows = `Entity`, columns = `FieldDef`, cells = the current `Claim`. A "Characters" board, a "Locations" board. This is the natural UI for the differentiator, and it needs **no new storage** — it is a view/query layer plus a grid UI.

Both are in scope, at different times: **workspaces first (cheap, urgent), database views later (the product payoff)**. v1 ships workspaces and the hover inspector; database views are a post-v1 additive feature.

---

## Field registry

Extraction and annotation must agree on field names, or Tier 2 diffing silently never fires (`eyes` from an annotation vs `eye_color` from the extractor). Fields are declared data, not conventions:

```
FieldDef {
  workspace_id
  field_key       // "eyes", "status", "family.son", "ally"
  value_type      // enum | string | number | boolean | entity_ref
  cardinality     // scalar | keyed_set
  enum_values     // nullable; required when value_type = enum
  applies_to      // entity kind(s) this field is valid for
  status          // active | deprecated
  successor_field_key  // nullable; set on rename so old claims remain queryable under the new field
  created_at
}
```

- **`scalar`** — one current value. `eyes`, `status`, `birth_year`.
- **`keyed_set`** — many members, each with a stable key. `ally:bob`, `family.son:alice`, `possession:sword`.

> **Locked convention:** the *base* field lives in `field_key` (singular: `ally`, `family.son`, `possession`); the *member key* lives in `claim_key` (`bob`, `alice`, `sword`). The old doc mixed forms (`family.sons: 2` as a count vs `family.son:alice` as a member). **A count is not a keyed_set** — if you want "number of sons", that is a derived scalar (`family.son_count`), computed from the set, not stored as a member.

**Renames are a migration by nature**, so make it a cheap, explicit one: setting `status: deprecated` + `successor_field_key` is additive and needs no data rewrite — readers follow the successor for display while old claims keep their original `field_key`. This is the one place the "no migration" promise is softened to **"additive-only, except registry renames, which are non-destructive redirection."**

---

## Claim shape

```
Claim {
  claim_id
  entity_id
  field_key        // FK -> FieldDef; NULL only for free-text notes
  claim_key        // member key for keyed_set; "_" for scalar; the note's own id for free-text notes
  value            // JSON, typed by FieldDef.value_type
  source_type      // authored | extracted
  source_location  // SourceLocation (stable block_id + span)
  mention_id       // nullable FK -> Mention; the mention an extracted claim came from
  status           // asserted | superseded | retracted
  supersedes_id    // nullable FK -> Claim; the version this replaced (may cross claim_key)
  change_kind      // addition | correction | in_story_change | retraction | unknown
  confidence       // nullable; extracted claims only
  verified         // unverified | confirmed | rejected
  extraction_meta  // nullable JSON: model_version, pattern_id, ...; extracted only
  discourse_seq    // monotonic capture order within the manuscript (stable tiebreak)
  narrative_order  // nullable int; story-time position, when known
  version          // per-(entity, field_key, claim_key) sequence number
  created_at
}
```

### Canonical semantics (this is the part that was ambiguous — now locked)

**Chain.** Claims are grouped by `(entity_id, field_key, claim_key)`. Each group is an append-only chain. `version` is a monotonic counter **within the chain** and is the authoritative order.

**Head.** The **head** of a chain is the row with the maximum `version` in that group. There is exactly one head per group.

**Current state.** An entity's current state is `{ head of each chain : head.status = asserted }`.
- A `superseded` or `retracted` head is **excluded** from current state but remains queryable as history.
- If a chain's head is `retracted`, the field simply has no current value (it does **not** fall back to the previous asserted claim — retraction means "this fact is withdrawn", not "revert to the old one"). If the writer intended a revert, that is a new `asserted` claim carrying the old value with `change_kind: correction`.
- The earlier "latest **asserted** claim" phrasing is retired: it was wrong for the retracted-sole-claim case. It is now "head, then filter by status."

**Writing a new value within a chain.** Insert a new row with `version = head.version + 1`, set its `supersedes_id = head.claim_id`, and flip the old head to `status: superseded`. This is the only way a normal update is expressed.

**Correction across `claim_key`s** (e.g. fixing a member key `ally:bob` → `ally:robert`, or renaming a keyed member). Per-key append-only forbids superseding a row in another chain in place. Express it as **two writes plus a cross-link**:
1. Retract the old chain's head (`status: retracted`, `change_kind: correction`).
2. Insert the corrected claim under the new `claim_key`, with `supersedes_id` pointing at the retracted old head — `supersedes_id` is explicitly allowed to cross `claim_key`, and that cross-key pointer *is* the record of the rename.
3. Optionally open a `Conflict { resolved_as_correction }` for the audit trail.

**Two clocks, one authority.** `version`/`discourse_seq` govern *append order and the reading view*. `narrative_order` governs *story-time queries only*. A flashback chapter written later does **not** change a claim's `version`; it may carry a lower `narrative_order`. Contradiction checks choose a clock deliberately: the default reading view uses `version`; `location-at-a-time` uses `narrative_order`.

**Free-text notes are chains too.** A free-text note has `field_key = NULL`. To keep notes from collapsing into one another, each note block uses its own stable `claim_key` (the annotation block's `block_id`). Editing that note block supersedes within *its* chain (`version + 1`); it never touches other notes. `Conflict` rows for notes leave `field_key`/`claim_key` NULL.

**`entity_ref` values.** A `value` of `value_type: entity_ref` stores a bare `entity_id`. Resolution follows `merged_into_id` on read, so a reference to a merged-away entity displays as the survivor. Referential integrity is enforced at write time; dangling refs are not permitted.

---

## Contradictions (v2)

A contradiction is a **separate record**, never a mutated claim — so it can be auto-created, reviewed, and resolved without touching claim history.

```
Conflict {
  conflict_id
  entity_id
  field_key       // nullable (NULL for free-text notes)
  claim_key       // nullable
  prior_claim_id
  new_claim_id
  tier            // t1_structured | t2_extracted | t3_soft
  status          // open | suggested | dismissed | resolved_as_change | resolved_as_correction
  created_at
}
```

**Idempotency:** a `Conflict` is unique on `(prior_claim_id, new_claim_id, tier)`. Re-running a check never duplicates a row.

**Review-state machine (`verified`):** `unverified → confirmed | rejected`; extracted claims start `unverified`, authored claims start `confirmed`. A `t3_soft` conflict starts `suggested`; a human promotes it to `open`, dismisses it, or resolves it. Suggested conflicts never block or flag automatically.

### Tier 1 — Structured field diffing (deterministic, no ML)

For any **scalar** field whose new asserted claim's value differs from the current head:
- Create `Conflict { tier: t1_structured, status: open }`; surface both source locations.
- `eyes: blue` (ch.2) → `eyes: green` (ch.14) is a straight diff, fully explainable to the writer.
- Covers physical attributes, status (alive/dead), family facts.

**Scope guard:** Tier 1 operates on `scalar` fields only. Set membership churn (a new ally) is a normal event, not a contradiction. Set diffs are still computed and shown as informational, never flagged.

**`location-at-a-time` caveat:** the original doc promised this in Tier 1, but a "latest location" model cannot evaluate "where was X when Y happened". This is now gated on `narrative_order` being known for both claims, and supports **point-equality** comparisons only ("was X at location L at story-point T"). Interval/containment reasoning ("during T1–T2") would be a later, additive extension — do not promise it in v2. Where timeline data is missing, the check reports "cannot evaluate — no timeline" instead of a false positive.

### Tier 2 — Extracted-claim contradiction (small model, narrow scope)

For facts pulled from prose: the same Tier 1 diffing applies once the value is in a field. The model's only job is NER-style slot-filling ("her eyes were blue" → `eyes: blue`), not judgment — the diff stays deterministic. Each extracted claim carries `mention_id`, `confidence`, `extraction_meta`, and starts `unverified`, so it can be reviewed before it is trusted.

### Tier 3 — Soft/free-text collision detection (embeddings) — **experiment, not committed**

For claims that don't map cleanly to a structured field — free-text notes, or looser prose descriptions:
- Use sentence embeddings to detect when two claims about the same entity are semantically close enough that they *might* describe the same fact in conflicting ways.
- **Suggestion layer only.** Writes `Conflict { tier: t3_soft, status: suggested }`. A human promotes it. Never an automatic flag.

> **Downgraded from v2 scope.** Suggestion-only is a product (review queue, ranking, precision/recall tuning), not a diff. Time-box it after Tier 1 ships, and only if real manuscripts show it beats manual review.

### Explicitly out of scope, even for v2

- Character trait / tone / arc contradictions ("was cruel in ch.3, showed mercy in ch.9") — requires narrative judgment (growth vs. inconsistency) that structured diffing and embeddings can't resolve. Out of scope without a generative LLM, and not planned even then without more design work.
- Automatic coreference ("her" → the right entity). See below.
- Interval/containment timeline reasoning (see Tier 1 caveat).

---

## Edit delta: what happens on edit

The semantic layer must define how editor operations produce/retire claims. Rules:

- **Annotation block edited** → **supersede** (not re-project in place). Parse the new content, insert claims that supersede the block's previous claims per chain. This produces superseded rows for typo churn, which is the honest trade — history stays truthful, and the reading view only shows heads. Idempotent re-parse of an unchanged block writes nothing.
- **Prose block edited** → any `Mention` on it has stale spans. Mark the mention `span_stale` (recompute from a marker if the editor node survived, else leave for manual re-link). Never silently re-point a mention to a different entity.
- **Block moved between pages** → `source_location.page_id` recomputes (it's denormalized). `discourse_seq` and `version` **do not change** — capture order is not document order. Claims stay in their original version order; only their displayed chapter label moves.
- **Block deleted** → claims get `status: retracted`; mentions become unresolved (`entity_id = NULL`).
- **Block split/merge** → see [Block ID stability rules](#blocks--the-document-body).
- **Page moved in the tree** → `page_id` on its blocks is unchanged; only navigation order changes. Page moves never touch claims.

---

## The hard problem: entity-mention resolution

**This, not extraction, is the blocking technical problem.** Hover on "King" only works if prose mentions bind to an entity, and that binding is where the design actually lives. The original spec reduced it to "custom Tiptap extension needed for entity mentions" — the extension is the easy half.

- **v1: manual linking only.** Writer types `@King` or selects text → "link to entity". Tedious but tractable, and it produces the ground-truth data automatic resolution will later be evaluated against.
- **v1 spike required before editor polish.** Prove the loop end-to-end on a toy document: link a mention → write an annotation block → hover shows accumulated state. **Because the store-first build order puts this before the editor, the spike reads claims already present in the store (seeded/stubbed); it does not depend on the editor existing.** If manual linking is unbearable in a real drafting session, that is a product finding to surface early.
- **v2+: exact-string and alias autolink** (`auto_exact`, `auto_alias`) — cheap, deterministic, high precision. Then, and only then, consider coreference and embeddings.

---

## Storage

> **Decision (researched against AppFlowy / Notion / AFFiNE).** AppFlowy does **not** store documents as JSON rows. Its JSON is import/export/FFI only; the authoritative store is a `yrs` CRDT blob (`EncodedCollab`), kept in RocksDB locally and Postgres `BYTEA` + S3 in the cloud. That is a heavy stack (RocksDB + CRDT + object store + sync protocol). Because Genesis v1 is single-user with no collaboration, there is **no CRDT and no RocksDB** — adopt the Notion shape: **one row per block** in a relational store. (Only immutable *snapshots* are stored as a whole-document JSON blob.)

**v1 store: SQLite, a single file.** One database holds all layers:

- **Documents** — `Workspace`, `Page`, `Block` rows; each block's `data` JSON (delta + type-specific keys). One row per block, **not** one blob per page: a per-page blob would force a full rewrite on every keystroke, prevent granular FTS/indexing, and fight the stable `block_id` address space the semantic layer depends on.
- **Snapshots** — immutable `Snapshot.content` blobs (the one justified blob).
- **Semantic layer** — `Entity`, `EntityAlias`, `EntityLineage`, `Mention`, `FieldDef`, `Claim`, `Conflict`, all relational.
- **Search** — an FTS5 virtual table over block text (external-content over `Block`, text extracted from the delta).

Why SQLite is sound here: JSON1 is built in, JSONB exists since 3.45, FTS5 has always been there, and the limits (281 TB file, 1 GB/row) will never bind a novel. The real constraints are operational, not capacity: **single writer** (fine — one novelist) and **WAL hygiene**. Configure `wal_autocheckpoint=0` + a background `wal_checkpoint(TRUNCATE)`, `journal_size_limit`, `busy_timeout=5000`, one write connection plus a read pool, `synchronous=NORMAL`.

**Escape hatch to multi-user (clean, no rewrite):** do **not** try to replicate SQLite rows to Postgres. Keep SQLite as the client cache and sync **CRDT deltas** to Postgres later (`updates` + `snapshots` `BYTEA` rows — the AFFiNE model), which is exactly why the backend is Rust: `yrs` updates are opaque blobs and need no schema migration. Commit to row-per-block now and this path stays open.

**Decision fork:** if Genesis is intended as a **hosted web SaaS from day one**, start on **Postgres** instead (row-per-block + `data` as `jsonb` + GIN on hot paths) and skip SQLite. For a local-first desktop app — what this spec describes — SQLite is correct. Everything below assumes local-first.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Tiptap | Bigger ecosystem than Svelte for block/Notion-style editors; more prior art. Custom Tiptap extension needed for entity mentions (clickable/hoverable nodes tied to the mention store) — bespoke either way. |
| Document format | **Delta block tree** (canonical), **Tiptap JSON** (editor) with a mapper | The canonical format is the AppFlowy-style `{type, data.delta, children}` tree. Tiptap emits ProseMirror JSON, so a load/save mapper is a named component with round-trip tests. |
| Backend | Rust (Axum or Actix) | Not required by any hard constraint (no CRDT need identified yet) — chosen because it's a stack you already know well, keeps this a decompression project. Go would work equally well. |
| Storage | **SQLite for v1** (see [Storage](#storage)); Postgres if/when multi-user or SaaS | Row-per-block documents + relational claims + FTS5, in one file. `data`-as-JSON ports to Postgres `jsonb` with a type swap, not a remodel. |
| LLM (BYOK) | Client-supplied key | **Not needed for v1 or v2 as scoped** — the extraction and contradiction work is non-generative. Kept only for future generative features (trait/arc judgment, prose rewrites). |
| Local NLP | Shell out to a Python NER service, or `rust-bert` if embedded | For the v2 prose-extraction pipeline only. **No NLP sidecar in v1.** |

**Note on Rust vs. Go:** if multi-device sync or collaborative/offline-first editing enters the roadmap later, that's a real reason to prefer Rust — the CRDT ecosystem (`yrs`, the Rust Yjs port) is notably stronger than Go's equivalents. Worth revisiting if that becomes a requirement; not a factor today.

---

## Build order

The original order was inverted: it listed per-field versioning as step 4, but the store, the inspector, and every v2 check depend on it. Storage must come first.

1. **Schema + storage.** `Workspace`, `Page`, `Block`, `Snapshot`, `Entity`, `EntityAlias`, `EntityLineage`, `Mention`, `FieldDef`, `Claim`, `Conflict`. SQLite. The load-bearing artifact — designed in this doc, implemented first.
2. **Claim store + versioning + registry (no UI).** Append-only writes, supersede chains, cross-key corrections, head/current-state queries, field seeding. Unit-testable and deterministic.
3. **Manual mention-linking spike → hover inspector, on a toy doc with seeded claims.** Proves the hard problem end-to-end without depending on the editor.
4. **Page tree + navigation.** Workspace → pages → blocks, root cluster listing children, click-to-navigate, create/rename/move. Pure CRUD over the tree.
5. **Tiptap editor + delta mapper + annotation-block capture.** Rich text, Notion-like blocks, the mapper with round-trip tests, the annotation block type (excluded from draft rendering and word count), edit-delta rules above.
6. **Snapshots.** Create/list/view immutable version pages. No diffing in v1.
7. **Inspector polish + per-field history.** Current accumulated state, sourced to its page; expand to version chains.
8. *(v2)* **Tier 1 scalar diffing + conflicts UI.**
9. *(v2)* **Timeline authoring** (`narrative_order`) — prerequisite for `location-at-a-time`.
10. *(v2)* **Prose extraction pipeline** (NER/rules → later, fine-tuned model). Its own project phase.
11. *(post-v1)* **Database/table views** over `Entity` + `FieldDef` + `Claim` — the product payoff. A view layer, no new storage.
12. *(experiment)* **Tier 3 embedding soft-collision suggestions.**
13. *(deferred, not scoped)* Reader-knowledge tracking, reveal tracking, relationship graphs, trait/arc contradiction judgment.

> Reader-knowledge and reveal tracking are deferred **but not free**: they need the same two-clock model (`discourse_seq` vs `narrative_order`). That is another reason the dual-time columns exist now.

---

## Prose extraction — model approach (v2, feeds Tier 2)

Goal: pull `eyes: blue` out of "her eyes were blue" without a generative LLM.

**Sequencing:**
1. **Start:** NER + rule/pattern matching (spaCy-equivalent, or `rust-bert` if staying in-stack). Pattern-match structures like "[PERSON]'s [attribute] [copula] [value]" against known `FieldDef`s. Deterministic, local, free, ships immediately — but breaks on messier phrasing ("her eyes, blue as the sea, ...").
2. **Later:** small fine-tuned extraction/slot-filling model (BERT-family scale, not generative) once there's training data. The writer's own confirmed annotation-block claims double as a bootstrapped training set over time.
3. **Optional hybrid:** embeddings to classify "this sentence is about eye color" before running value extraction — splits detection and extraction into two easier sub-problems.

This is real ML-engineering work, not glue code — treat it as its own project phase. The rule-based version is worth shipping, but be honest: it will not cover real prose variation, and bootstrapping a fine-tuned model from sparse annotation blocks is a separate ML project, not an incremental step.

---

## Resolved in this revision

- **Tier 1 promised `location-at-a-time`, but the model stored one latest location.** → `narrative_order` gives a second clock; the check is gated on timeline data, point-equality only, and reports "cannot evaluate" otherwise.
- **"No schema change for extraction" was false.** → `confidence`, `extraction_meta`, `verified`, `mention_id`, and stable spans are present from day one.
- **"Docstrings" both "never rendered" and "parsed out of the visible draft."** → a dedicated annotation `Block` type, excluded from draft rendering/export/word count, projected into claims on save.
- **BYOK was in the stack but irrelevant to v1/v2.** → marked future-only; no key handling in v1/v2.
- **Chapter/Block tables were undefined.** → `Workspace` + `Page` + `Block` with explicit ID-stability and split/merge rules.
- **Free-text notes collapsed into one append-only chain.** → each note gets its own `claim_key` (its block id); `Conflict` accepts NULL `field_key`/`claim_key`.
- **Current-state predicate was contradictory for retracted rows.** → defined as "head, then filter by `status = asserted`"; retraction withdraws, doesn't revert.
- **Cross-`claim_key` corrections were unexpressible.** → retract old head + insert new with a cross-key `supersedes_id`, plus optional `resolved_as_correction` conflict.
- **`narrative_order` type / scope was unspecified.** → nullable int; point-equality checks only in v2.
- **Field renames and auto-resolution provenance had no home.** → `FieldDef.status`/`successor_field_key`; `Mention.confidence`/`provenance`; `EntityLineage` for merge/split.
- **Document format was markdown / assumed to be "JSON like AppFlowy."** → canonical **delta block tree**, Tiptap ProseMirror JSON as the editor format with a mapper; markdown is export-only.
- **Page navigation and story versions were unmodeled.** → `Workspace` → `Page` tree (folder/story/version/chapter) → `Block` tree, plus immutable `Snapshot` for `kind: version`.
- **"Multiple tables" was ambiguous.** → resolved as two orthogonal layers: **workspaces** (isolation, v1) and **database views** (display over entities, post-v1).

## Open questions

- Does re-parsing an annotation block into superseding claims produce too much typo-churn history? Mitigation is a debounce/diff at the block level; revisit if real use shows it's noisy.
- Should `family.son_count` (and other derived scalars) be materialized or computed on read? v1 can compute on read; materialize only if it becomes a hot path.
- SQLite `value` JSON vs Postgres `jsonb`: confirm at implementation that head/current-state queries can be expressed efficiently on JSON values, or promote the small set of hot fields to typed columns later (additive).
- Delta↔ProseMirror mapper fidelity: define the exact supported mark set up front and fail loudly on unsupported constructs rather than dropping them silently.

---

## Changelog vs. v1

| Gap in v1 spec | Fix in this draft |
|---|---|
| No claim identity / supersede link | `claim_id` + `supersedes_id` + `status` chain |
| Deletion = ghost facts | `status: retracted` rows, never deletes |
| Correction vs. plot change conflated | `change_kind` enum + human resolution |
| No verification/confirmation state | `verified` + `confidence` + `extraction_meta` |
| Set fields collapse under "latest wins" | `claim_key` → per-member version chains |
| Field names can diverge (`eyes` vs `eye_color`) | `FieldDef` registry with types + cardinality + rename redirection |
| Entity identity assumed | `Entity` / `EntityAlias` / `EntityLineage` / `Mention` model |
| Paragraph-number source locations drift | stable `block_id` + span; `Workspace`/`Page`/`Block` defined |
| "Latest" conflates authored order with story time | `discourse_seq` vs `narrative_order`; locked head/current-state predicate |
| Free-text notes shared one chain | per-note `claim_key` |
| Cross-key corrections unexpressible | cross-key `supersedes_id` + retraction |
| Contradictions had no home | `Conflict` table, tiered + reviewable + idempotent |
| Document storage unstated / assumed markdown or CRDT-JSON | delta block tree, row-per-block SQLite + FTS5 |
| No page hierarchy or navigation | `Workspace` → `Page` tree → `Block` tree |
| Story versions unmodeled | immutable `Snapshot`, `kind: version` pages |
| "Multiple tables" ambiguous | workspaces (isolation) vs. database views (display) |
| Build order put versioning 4th | storage + versioning + linking spike first |
