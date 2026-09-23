use sqlx::PgPool;
use store::PageRepository;
use uuid::Uuid;

fn db_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .ok()
}

#[tokio::test]
async fn patch_self_parent_is_rejected() {
    let Some(url) = db_url() else {
        eprintln!("SKIP patch_self_parent: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'cycle-test')")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("workspace inserts");
    let page_id = Uuid::new_v4();
    sqlx::query("INSERT INTO page (id, workspace_id, kind, title) VALUES ($1,$2,'chapter','t')")
        .bind(page_id)
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("page inserts");

    let err = PageRepository::new(&pool)
        .patch(page_id, None, Some(Some(page_id)), None, None)
        .await
        .expect_err("self-parent must be rejected");
    assert!(err.to_string().contains("own parent"), "unexpected: {err}");

    let page = PageRepository::new(&pool)
        .get(page_id)
        .await
        .expect("page still readable");
    assert_eq!(page.parent_page_id, None);

    sqlx::query("DELETE FROM workspace WHERE id = $1")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("cleanup workspace");
}

#[tokio::test]
async fn patch_two_cycle_is_rejected() {
    let Some(url) = db_url() else {
        eprintln!("SKIP patch_two_cycle: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'cycle-test-2')")
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

    PageRepository::new(&pool)
        .patch(page_a, None, Some(Some(page_b)), None, None)
        .await
        .expect("A->B ok");

    let err = PageRepository::new(&pool)
        .patch(page_b, None, Some(Some(page_a)), None, None)
        .await
        .expect_err("B->A must be rejected");
    assert!(err.to_string().contains("cycle"), "unexpected: {err}");

    let b = PageRepository::new(&pool)
        .get(page_b)
        .await
        .expect("B readable");
    assert_eq!(b.parent_page_id, None);

    let cleared = PageRepository::new(&pool)
        .patch(page_a, None, Some(None), None, None)
        .await
        .expect("clear works");
    assert_eq!(cleared.parent_page_id, None);

    sqlx::query("DELETE FROM workspace WHERE id = $1")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("cleanup workspace");
}
