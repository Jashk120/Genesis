use domain::FlatBlock;
use sqlx::PgPool;
use store::BlockRepository;
use uuid::Uuid;

fn db_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .ok()
}

async fn setup_page(pool: &PgPool) -> (Uuid, Uuid) {
    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'blocks-test')")
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("workspace inserts");
    let page_id = Uuid::new_v4();
    sqlx::query("INSERT INTO page (id, workspace_id, kind, title) VALUES ($1,$2,'chapter','t')")
        .bind(page_id)
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("page inserts");
    (ws_id, page_id)
}

async fn teardown(pool: &PgPool, ws_id: Uuid, entity_id: Option<Uuid>) {
    if let Some(e) = entity_id {
        sqlx::query("DELETE FROM entity WHERE id = $1")
            .bind(e)
            .execute(pool)
            .await
            .expect("cleanup entity");
    }
    sqlx::query("DELETE FROM workspace WHERE id = $1")
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("cleanup workspace");
}

fn flat(id: Uuid, parent: Option<Uuid>, ordinal: i32) -> FlatBlock {
    FlatBlock {
        id,
        parent_block_id: parent,
        block_type: "paragraph".to_string(),
        data: serde_json::json!({"delta": []}),
        ordinal,
    }
}

async fn mention_count(pool: &PgPool, mention_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM mention WHERE id = $1")
        .bind(mention_id)
        .fetch_one(pool)
        .await
        .expect("count queries")
}

#[tokio::test]
async fn mention_survives_unchanged_autosave() {
    let Some(url) = db_url() else {
        eprintln!("SKIP mention_survives_unchanged_autosave: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, page_id) = setup_page(&pool).await;

    let block_id = Uuid::new_v4();
    BlockRepository::new(&pool)
        .replace_for_page(page_id, &[flat(block_id, None, 0)])
        .await
        .expect("blocks save");

    let entity_id = Uuid::new_v4();
    sqlx::query("INSERT INTO entity (id, workspace_id, canonical_name, kind) VALUES ($1,$2,'King','character')")
        .bind(entity_id)
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("entity inserts");
    let mention_id = Uuid::new_v4();
    sqlx::query("INSERT INTO mention (id, entity_id, block_id, span_start, span_end, surface_form, resolution) VALUES ($1,$2,$3,0,4,'King','manual')")
        .bind(mention_id)
        .bind(entity_id)
        .bind(block_id)
        .execute(&pool)
        .await
        .expect("mention inserts");

    BlockRepository::new(&pool)
        .replace_for_page(page_id, &[flat(block_id, None, 0)])
        .await
        .expect("autosave runs");

    assert_eq!(mention_count(&pool, mention_id).await, 1);

    teardown(&pool, ws_id, Some(entity_id)).await;
}

#[tokio::test]
async fn mention_for_removed_block_is_gone() {
    let Some(url) = db_url() else {
        eprintln!("SKIP mention_for_removed_block_is_gone: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, page_id) = setup_page(&pool).await;

    let keep_id = Uuid::new_v4();
    let drop_id = Uuid::new_v4();
    BlockRepository::new(&pool)
        .replace_for_page(page_id, &[flat(keep_id, None, 0), flat(drop_id, None, 1)])
        .await
        .expect("blocks save");

    let entity_id = Uuid::new_v4();
    sqlx::query("INSERT INTO entity (id, workspace_id, canonical_name, kind) VALUES ($1,$2,'King','character')")
        .bind(entity_id)
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("entity inserts");
    let mention_id = Uuid::new_v4();
    sqlx::query("INSERT INTO mention (id, entity_id, block_id, span_start, span_end, surface_form, resolution) VALUES ($1,$2,$3,0,4,'King','manual')")
        .bind(mention_id)
        .bind(entity_id)
        .bind(drop_id)
        .execute(&pool)
        .await
        .expect("mention inserts");

    BlockRepository::new(&pool)
        .replace_for_page(page_id, &[flat(keep_id, None, 0)])
        .await
        .expect("prune runs");

    assert_eq!(mention_count(&pool, mention_id).await, 0);
    let remaining = BlockRepository::new(&pool)
        .list_for_page(page_id)
        .await
        .expect("blocks list");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, keep_id);

    teardown(&pool, ws_id, Some(entity_id)).await;
}

#[tokio::test]
async fn nested_tree_round_trips_through_replace() {
    let Some(url) = db_url() else {
        eprintln!(
            "SKIP nested_tree_round_trips_through_replace: TEST_DATABASE_URL/DATABASE_URL unset"
        );
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, page_id) = setup_page(&pool).await;

    let parent_id = Uuid::new_v4();
    let child_id = Uuid::new_v4();
    BlockRepository::new(&pool)
        .replace_for_page(
            page_id,
            &[flat(parent_id, None, 0), flat(child_id, Some(parent_id), 0)],
        )
        .await
        .expect("blocks save");

    let rows = BlockRepository::new(&pool)
        .list_for_page(page_id)
        .await
        .expect("blocks list");
    assert_eq!(rows.len(), 2);
    let tree = domain::block::assemble_tree(&rows);
    assert_eq!(tree.children.len(), 1);
    assert_eq!(tree.children[0].id, Some(parent_id));
    assert_eq!(tree.children[0].children.len(), 1);
    assert_eq!(tree.children[0].children[0].id, Some(child_id));

    let again = domain::block::flatten_tree(page_id, &tree).expect("tree flattens");
    BlockRepository::new(&pool)
        .replace_for_page(page_id, &again)
        .await
        .expect("autosave runs");
    let rows = BlockRepository::new(&pool)
        .list_for_page(page_id)
        .await
        .expect("blocks list");
    assert_eq!(rows.len(), 2);

    BlockRepository::new(&pool)
        .replace_for_page(page_id, &[])
        .await
        .expect("empty replace runs");
    let rows = BlockRepository::new(&pool)
        .list_for_page(page_id)
        .await
        .expect("blocks list");
    assert!(rows.is_empty());

    teardown(&pool, ws_id, None).await;
}

#[tokio::test]
async fn cross_page_block_id_is_rejected_and_original_untouched() {
    let Some(url) = db_url() else {
        eprintln!("SKIP cross_page_block_id: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'cross-page-test')")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("workspace inserts");
    let page_a = Uuid::new_v4();
    let page_b = Uuid::new_v4();
    for pid in [page_a, page_b] {
        sqlx::query(
            "INSERT INTO page (id, workspace_id, kind, title) VALUES ($1,$2,'chapter','t')",
        )
        .bind(pid)
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("page inserts");
    }

    let shared_id = Uuid::new_v4();
    let original = FlatBlock {
        id: shared_id,
        parent_block_id: None,
        block_type: "paragraph".to_string(),
        data: serde_json::json!({"delta": [{"insert": "original-A"}]}),
        ordinal: 0,
    };
    BlockRepository::new(&pool)
        .replace_for_page(page_a, &[original])
        .await
        .expect("seed page A");

    let hijack = FlatBlock {
        id: shared_id,
        parent_block_id: None,
        block_type: "paragraph".to_string(),
        data: serde_json::json!({"delta": [{"insert": "evil-B"}]}),
        ordinal: 0,
    };
    let err = BlockRepository::new(&pool)
        .replace_for_page(page_b, &[hijack])
        .await
        .expect_err("cross-page id must be rejected");
    let msg = err.to_string();
    assert!(
        msg.contains("already belongs to another page"),
        "unexpected error: {msg}"
    );

    let rows_a = BlockRepository::new(&pool)
        .list_for_page(page_a)
        .await
        .expect("list A");
    assert_eq!(rows_a.len(), 1);
    assert_eq!(rows_a[0].id, shared_id);
    assert_eq!(
        rows_a[0].data,
        serde_json::json!({"delta": [{"insert": "original-A"}]})
    );
    let rows_b = BlockRepository::new(&pool)
        .list_for_page(page_b)
        .await
        .expect("list B");
    assert!(rows_b.is_empty());

    teardown(&pool, ws_id, None).await;
}
