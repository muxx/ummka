use crate::{
    history::{AccountHistory, ChannelHistoryPage, PageWrite, PostChange, WindowSource},
    rest::TransportError,
    sessions::AccountSessions,
};

const RECORDS: &str =
    include_str!("../../../contracts/mattermost/fixtures/channel-post-changes.json");

pub(super) async fn seed(sessions: &AccountSessions, origin: &str) -> Result<(), TransportError> {
    for (name, user) in [
        ("one", "Abc01234567890123456789012"),
        ("two", "bbbbbbbbbbbbbbbbbbbbbbbbbb"),
    ] {
        let url = format!("{origin}/offline-history/{name}");
        sessions
            .activate(&url, user, &format!("fixture-local-{name}"))
            .await?;
        let session = sessions.restore(&url, user).await?;
        let mut history = sessions.open_history(session).await?;
        tauri::async_runtime::spawn_blocking(move || seed_pages(&mut history, name))
            .await
            .expect("local history fixture worker")
            .map_err(|_| TransportError::HistoryStorageUnavailable)?;
    }
    Ok(())
}

fn seed_pages(view: &mut AccountHistory, name: &str) -> Result<(), crate::history::HistoryError> {
    let root = "r".repeat(26);
    let reply = "p".repeat(26);
    let mut page = ChannelHistoryPage {
        channel_id: "c".repeat(26),
        collapsed_threads: false,
        source: WindowSource::Latest,
        order: vec![reply.clone(), root],
        changes: serde_json::from_str(RECORDS).expect("valid shared post records"),
        prev_post_id: Some("q".repeat(26)),
        next_post_id: Some(String::new()),
        first_inaccessible_post_time: Some(70),
    };
    for change in &mut page.changes {
        if let PostChange::Save(post) = change
            && post.id == reply
        {
            post.message = format!("Offline reply for {name}");
            post.create_at = 100;
        }
    }
    let mut apply = |page: &ChannelHistoryPage| {
        let receipt = view.begin_channel_load(&page.channel_id)?;
        assert_eq!(
            view.apply_channel_window(receipt, page)?,
            PageWrite::Applied
        );
        Ok::<_, crate::history::HistoryError>(())
    };
    apply(&page)?;
    page.collapsed_threads = true;
    page.order.remove(0);
    apply(&page)?;
    page.channel_id = "f".repeat(26);
    page.collapsed_threads = false;
    page.order.clear();
    page.changes.clear();
    page.prev_post_id = Some(String::new());
    page.first_inaccessible_post_time = None;
    apply(&page)
}
