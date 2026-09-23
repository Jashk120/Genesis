use domain::FlatBlock;
use sqlx::PgPool;
use store::{BlockRepository, PageRepository, SnapshotRepository};
use uuid::Uuid;

fn db_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .ok()
}

async fn setup_tree(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'snapshot-test')")
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("workspace inserts");
    let story_id = Uuid::new_v4();
    sqlx::query("INSERT INTO page (id, workspace_id, kind, title) VALUES ($1,$2,'story','Novel')")
        .bind(story_id)
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("story inserts");
    let chapter_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO page (id, workspace_id, parent_page_id, kind, title) VALUES ($1,$2,$3,'chapter','Ch1')",
    )
    .bind(chapter_id)
    .bind(ws_id)
    .bind(story_id)
    .execute(pool)
    .await
    .expect("chapter inserts");
    let seed = |text: &str| FlatBlock {
        id: Uuid::new_v4(),
        parent_block_id: None,
        block_type: "paragraph".to_string(),
        data: serde_json::json!({"delta": [{"insert": text}]}),
        ordinal: 0,
    };
    BlockRepository::new(pool)
        .replace_for_page(story_id, &[seed("once upon a time")])
        .await
        .expect("story blocks save");
    BlockRepository::new(pool)
        .replace_for_page(chapter_id, &[seed("chapter one")])
        .await
        .expect("chapter blocks save");
    (ws_id, story_id, chapter_id)
}

async fn teardown(pool: &PgPool, ws_id: Uuid) {
    sqlx::query("DELETE FROM snapshot WHERE workspace_id = $1")
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("cleanup snapshots");
    sqlx::query("DELETE FROM workspace WHERE id = $1")
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("cleanup workspace");
}

#[tokio::test]
async fn migration_003_is_applied() {
    let Some(url) = db_url() else {
        eprintln!("SKIP migration_003_is_applied: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let v3: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE version = 3")
        .fetch_one(&pool)
        .await
        .expect("migration table reads");
    assert_eq!(v3, 1, "migration 003 must be applied");
}

#[tokio::test]
async fn snapshot_crud_dedupe_and_restrict() {
    let Some(url) = db_url() else {
        eprintln!("SKIP snapshot_crud_dedupe_and_restrict: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, chapter_id) = setup_tree(&pool).await;
    let repo = SnapshotRepository::new(&pool);

    // Create returns seq=1, block_count>0, non-empty hash.
    let m1 = repo.create(story_id, "v1").await.expect("snapshot creates");
    assert_eq!(m1.seq, 1);
    assert!(!m1.content_hash.is_empty());
    assert!(m1.block_count.unwrap_or(0) > 0);

    // List returns metadata only (type-level: SnapshotMeta has no content).
    let list = repo
        .list_meta_for_page(story_id)
        .await
        .expect("snapshot lists");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].label, "v1");

    // Unchanged content with a new label is rejected as no-change.
    let err = repo
        .create(story_id, "v1b")
        .await
        .expect_err("unchanged content must be NoChange");
    assert!(
        matches!(err, store::StoreError::NoChange(_)),
        "unexpected error: {err}"
    );

    // Edit blocks, then a new label succeeds with seq=2 + different hash.
    let edited = FlatBlock {
        id: Uuid::new_v4(),
        parent_block_id: None,
        block_type: "paragraph".to_string(),
        data: serde_json::json!({"delta": [{"insert": "once upon a darker time"}]}),
        ordinal: 0,
    };
    BlockRepository::new(&pool)
        .replace_for_page(story_id, &[edited])
        .await
        .expect("story blocks edit");
    let m2 = repo.create(story_id, "v2").await.expect("v2 creates");
    assert_eq!(m2.seq, 2);
    assert_ne!(m2.content_hash, m1.content_hash);

    // Duplicate label is a conflict.
    let err = repo
        .create(story_id, "v1")
        .await
        .expect_err("duplicate label must be Conflict");
    assert!(
        matches!(err, store::StoreError::Conflict(_)),
        "unexpected error: {err}"
    );

    // Get returns the full envelope with pages + trees.
    let full = repo.get(m2.id).await.expect("snapshot gets");
    assert_eq!(full.source_page_id, story_id);
    assert_eq!(full.seq, 2);
    let env: domain::SnapshotEnvelope =
        serde_json::from_value(full.content).expect("content is an envelope");
    assert_eq!(env.root_page_id, story_id);
    assert_eq!(env.pages.len(), 2);
    assert!(env.trees.contains_key(&story_id.to_string()));
    assert!(env.trees.contains_key(&chapter_id.to_string()));

    // Latest + count helpers agree.
    let latest = repo
        .latest_for_page(story_id)
        .await
        .expect("latest reads")
        .expect("latest present");
    assert_eq!(latest.id, m2.id);
    assert_eq!(repo.count_for_page(story_id).await.expect("count reads"), 2);

    // FK is RESTRICT: deleting a snapshotted page must error.
    let del: Result<_, sqlx::Error> = sqlx::query("DELETE FROM page WHERE id = $1")
        .bind(story_id)
        .execute(&pool)
        .await;
    assert!(
        del.is_err(),
        "DELETE of a snapshotted page must be restricted"
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn restore_into_live_reverts_titles_and_blocks() {
    let Some(url) = db_url() else {
        eprintln!("SKIP restore_into_live_reverts: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, chapter_id) = setup_tree(&pool).await;
    let repo = SnapshotRepository::new(&pool);

    let m1 = repo.create(story_id, "v1").await.expect("snapshot creates");
    let full = repo.get(m1.id).await.expect("snapshot gets");
    let env: domain::SnapshotEnvelope =
        serde_json::from_value(full.content).expect("content is an envelope");
    assert_eq!(env.pages.len(), 2);

    for (id, title) in [(story_id, "Renamed Novel"), (chapter_id, "Renamed Ch1")] {
        sqlx::query("UPDATE page SET title = $2 WHERE id = $1")
            .bind(id)
            .bind(title)
            .execute(&pool)
            .await
            .expect("title updates");
    }
    let edited = FlatBlock {
        id: Uuid::new_v4(),
        parent_block_id: None,
        block_type: "paragraph".to_string(),
        data: serde_json::json!({"delta": [{"insert": "rewritten live text"}]}),
        ordinal: 0,
    };
    BlockRepository::new(&pool)
        .replace_for_page(story_id, &[edited])
        .await
        .expect("story blocks edit");

    let restored = repo.restore_into_live(&env).await.expect("restore works");
    assert_eq!(restored, 2);

    let story = PageRepository::new(&pool)
        .get(story_id)
        .await
        .expect("story reads");
    assert_eq!(story.title, "Novel");
    let chapter = PageRepository::new(&pool)
        .get(chapter_id)
        .await
        .expect("chapter reads");
    assert_eq!(chapter.title, "Ch1");
    let live = BlockRepository::new(&pool)
        .list_for_page(story_id)
        .await
        .expect("live blocks read");
    assert_eq!(live.len(), 1);
    assert!(live[0].data.to_string().contains("once upon a time"));

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn restore_into_live_is_atomic_and_skips_deleted_pages() {
    let Some(url) = db_url() else {
        eprintln!("SKIP restore_atomicity: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, chapter_id) = setup_tree(&pool).await;
    let repo = SnapshotRepository::new(&pool);

    let m1 = repo.create(story_id, "v1").await.expect("snapshot creates");
    let full = repo.get(m1.id).await.expect("snapshot gets");
    let env: domain::SnapshotEnvelope =
        serde_json::from_value(full.content).expect("content is an envelope");

    let mut bad_env = env.clone();
    let tree = bad_env
        .trees
        .get_mut(&chapter_id.to_string())
        .expect("chapter tree present");
    tree.children.first_mut().expect("chapter has a block").data = serde_json::json!("bogus");

    sqlx::query("UPDATE page SET title = $2 WHERE id = $1")
        .bind(story_id)
        .bind("Broken Title")
        .execute(&pool)
        .await
        .expect("title updates");
    let broken = FlatBlock {
        id: Uuid::new_v4(),
        parent_block_id: None,
        block_type: "paragraph".to_string(),
        data: serde_json::json!({"delta": [{"insert": "broken live text"}]}),
        ordinal: 0,
    };
    BlockRepository::new(&pool)
        .replace_for_page(story_id, &[broken])
        .await
        .expect("story blocks edit");

    let err = repo
        .restore_into_live(&bad_env)
        .await
        .expect_err("corrupt tree must fail");
    assert!(
        matches!(err, store::StoreError::Domain(_)),
        "unexpected error: {err}"
    );
    let story = PageRepository::new(&pool)
        .get(story_id)
        .await
        .expect("story reads");
    assert_eq!(story.title, "Broken Title", "title change rolled back");
    let live = BlockRepository::new(&pool)
        .list_for_page(story_id)
        .await
        .expect("live blocks read");
    assert!(live[0].data.to_string().contains("broken live text"));

    PageRepository::new(&pool)
        .delete(chapter_id)
        .await
        .expect("chapter deletes");
    let restored = repo.restore_into_live(&env).await.expect("restore works");
    assert_eq!(restored, 1);
    let chapter: Option<Uuid> = sqlx::query_scalar("SELECT id FROM page WHERE id = $1")
        .bind(chapter_id)
        .fetch_optional(&pool)
        .await
        .expect("chapter lookup reads");
    assert!(chapter.is_none(), "deleted pages are not recreated");
    let story = PageRepository::new(&pool)
        .get(story_id)
        .await
        .expect("story reads");
    assert_eq!(story.title, "Novel");

    let ghost = Uuid::new_v4();
    let empty_env = domain::SnapshotEnvelope {
        version: 1,
        root_page_id: ghost,
        pages: vec![domain::SnapshotPageMeta {
            id: ghost,
            kind: "story".to_string(),
            title: "Ghost".to_string(),
            parent_page_id: None,
            ordinal: 0,
            narrative_order: None,
        }],
        trees: Default::default(),
    };
    let restored = repo
        .restore_into_live(&empty_env)
        .await
        .expect("empty restore works");
    assert_eq!(restored, 0);

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn delete_with_history_is_atomic_and_404_preserves_history() {
    let Some(url) = db_url() else {
        eprintln!("SKIP delete_with_history: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_tree(&pool).await;
    let repo = SnapshotRepository::new(&pool);
    repo.create(story_id, "v1").await.expect("snapshot creates");

    let missing = Uuid::new_v4();
    let err = PageRepository::new(&pool)
        .delete_with_history(missing)
        .await
        .expect_err("missing page must be NotFound");
    assert!(
        matches!(err, store::StoreError::NotFound(_)),
        "unexpected error: {err}"
    );
    assert_eq!(
        repo.count_for_page(story_id).await.expect("count reads"),
        1,
        "history survives a 404 delete"
    );

    PageRepository::new(&pool)
        .delete_with_history(story_id)
        .await
        .expect("delete with history works");
    assert_eq!(repo.count_for_page(story_id).await.expect("count reads"), 0);
    let page = PageRepository::new(&pool).get(story_id).await;
    assert!(
        matches!(page, Err(store::StoreError::NotFound(_))),
        "page is gone"
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn concurrent_creates_get_distinct_seqs() {
    let Some(url) = db_url() else {
        eprintln!("SKIP concurrent_creates: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_tree(&pool).await;

    let repo_a = SnapshotRepository::new(&pool);
    let repo_b = SnapshotRepository::new(&pool);
    let (ra, rb) = tokio::join!(repo_a.create(story_id, "ca"), repo_b.create(story_id, "cb"));

    // Honest invariant: identical content raced, so one creator may observe the
    // other's snapshot as latest and correctly return NoChange. Either outcome
    // is valid; anything else is a bug.
    let mut seqs: Vec<i32> = Vec::new();
    let mut no_change_count = 0;
    for r in [ra, rb] {
        match r {
            Ok(meta) => seqs.push(meta.seq),
            Err(store::StoreError::NoChange(_)) => no_change_count += 1,
            Err(other) => panic!("concurrent create failed unexpectedly: {other}"),
        }
    }
    assert!(
        !seqs.is_empty(),
        "at least one concurrent create must succeed"
    );
    assert!(
        no_change_count <= 1,
        "at most one racer may observe NoChange, got {no_change_count}"
    );
    let mut sorted = seqs.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(
        sorted.len(),
        seqs.len(),
        "successful seqs must be distinct, got {seqs:?}"
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn create_after_preseeded_seq_assigns_next_seq() {
    let Some(url) = db_url() else {
        eprintln!("SKIP preseeded_seq: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_tree(&pool).await;

    // Pre-seed seq=1 with a foreign content_hash so the no-change check cannot
    // trigger; the next create must land on seq=2 via the MAX(seq)+1 path.
    sqlx::query(
        "INSERT INTO snapshot (id, source_page_id, workspace_id, label, seq, content, content_hash, scope_page_ids, is_materialized) VALUES ($1,$2,$3,'seeded',1,'{}','preseeded-foreign-hash',ARRAY[]::UUID[],TRUE)",
    )
    .bind(Uuid::new_v4())
    .bind(story_id)
    .bind(ws_id)
    .execute(&pool)
    .await
    .expect("seeded snapshot inserts");

    let meta = SnapshotRepository::new(&pool)
        .create(story_id, "after-seed")
        .await
        .expect("create after preseed succeeds");
    assert_eq!(meta.seq, 2);

    teardown(&pool, ws_id).await;
}
