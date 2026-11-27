use super::{
    ALICE, BOB, account,
    posts::{CHANNEL, ROOT},
    windows::{apply, page},
};
use crate::history::{
    AccountHistory, ChannelHistoryPage, DeliveryPost, DeliverySource, DirectoryTeam, DraftSave,
    HistoryError, PageWrite, PostChange, RetryPost, SidebarData, StagePost, WindowSource,
    posts::DisplayPriority,
};
use serde_json::json;
use std::path::Path;

const URL: &str = "https://departure.example.test/team";
const TEAM: &str = "tttttttttttttttttttttttttt";
const OTHER_TEAM: &str = "uuuuuuuuuuuuuuuuuuuuuuuuuu";
const NEIGHBOR: &str = "nnnnnnnnnnnnnnnnnnnnnnnnnn";
const NEIGHBOR_POST: &str = "oooooooooooooooooooooooooo";
const REPLY: &str = "pppppppppppppppppppppppppp";
const EMPTY_EDITOR: &str = "eeeeeeeeeeeeeeeeeeeeeeeeee";
const DM: &str = "dddddddddddddddddddddddddd";
const GROUP: &str = "gggggggggggggggggggggggggg";

fn sidebar() -> SidebarData {
    let rows = [(CHANNEL, "P"), (NEIGHBOR, "O"), (DM, "D"), (GROUP, "G")];
    serde_json::from_value(json!({
        "channels": rows.map(|(id, kind)| json!({
            "id":id,"kind":kind,"name":id,"displayName":id,"header":"","purpose":"",
            "deleteAt":0,"muted":false
        })),
        "categories":[{
            "id":"channels","kind":"channels","displayName":"Channels","sorting":"manual",
            "collapsed":false,"muted":false,"channelIds":rows.map(|(id,_)|id)
        }]
    }))
    .unwrap()
}

fn publish_sidebar(view: &mut AccountHistory) -> Result<(), HistoryError> {
    let load = view.begin_sidebar_load(TEAM)?.unwrap();
    assert!(view.store_sidebar(load, &sidebar())?);
    Ok(())
}

fn seed_sidebar(view: &mut AccountHistory) -> Result<(), HistoryError> {
    let teams = [TEAM, OTHER_TEAM].map(|id| DirectoryTeam {
        id: id.into(),
        name: id.into(),
        display_name: id.into(),
        preference_rank: None,
        roles: None,
        group_constrained: None,
    });
    let load = view.begin_team_directory_load()?;
    assert!(view.store_team_directory(load, &teams, None)?);
    publish_sidebar(view)
}

fn save_text(
    view: &mut AccountHistory,
    room: &str,
    root: Option<&str>,
    text: &str,
) -> Result<String, HistoryError> {
    let before = view.read_draft(room, root)?;
    let DraftSave::Saved(saved) = view.save_draft(room, root, before.revision.as_deref(), text)?
    else {
        panic!("fixture draft must be saved");
    };
    Ok(saved.revision.unwrap())
}

fn receipt(room: &str, id: &str) -> DeliveryPost {
    DeliveryPost {
        id: id.into(),
        user_id: ALICE.into(),
        channel_id: room.into(),
        root_id: None,
    }
}

// Leave a real outbox row with both an attempt and a server confirmation. The
// canonical post is intentionally still outside the local history window.
fn queue(view: &mut AccountHistory, room: &str, server_post: &str) -> Result<String, HistoryError> {
    let revision = save_text(view, room, None, "queued")?;
    let StagePost::Created { post, .. } = view.stage_post(room, None, &revision)? else {
        panic!("fixture post must be queued");
    };
    assert!(
        view.retry_post(&post.pending_id, 1, RetryPost::DespiteUnknownDelivery)?
            .is_some()
    );
    assert!(view.confirm_delivery(
        DeliverySource::Posted,
        Some(&post.pending_id),
        &receipt(room, server_post)
    )?);
    Ok(post.pending_id)
}

fn check_outbox(
    view: &mut AccountHistory,
    room: &str,
    pending: &str,
    present: bool,
) -> Result<(), HistoryError> {
    assert_eq!(
        view.pending_posts(room, None, 0, 10)?
            .iter()
            .any(|post| post.pending_id == pending),
        present
    );
    let children: (bool, bool) = view.read(|tx| {
        tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM post_attempt WHERE pending_id=?1),
                EXISTS(SELECT 1 FROM post_confirmation WHERE pending_id=?1)",
            [pending],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    })?;
    assert_eq!(children, (present, present));
    Ok(())
}

fn check_departing_data(
    view: &mut AccountHistory,
    pending: &str,
    present: bool,
) -> Result<(), HistoryError> {
    for id in [ROOT, REPLY] {
        assert_eq!(view.read_post(id)?.is_some(), present);
    }
    if present {
        let post = view.read_post(ROOT)?.unwrap();
        assert_eq!(post.display_priority, Some(DisplayPriority::Important));
        assert_eq!(
            serde_json::to_value(post.ai_attribution).unwrap(),
            json!({"kind":"source","userId":BOB,"hasUsername":true})
        );
    }
    for collapsed in [true, false] {
        assert_eq!(
            view.read_latest_window(CHANNEL, collapsed, 5)?.is_some(),
            present
        );
    }
    for (root, message) in [(None, "room note"), (Some(ROOT), "thread note")] {
        assert_eq!(
            view.read_draft(CHANNEL, root)?.message,
            if present { message } else { "" }
        );
    }
    let children: (bool, bool) = view.read(|tx| {
        tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM history_thread_summary WHERE post_id=?1),
                EXISTS(SELECT 1 FROM history_post_attachment WHERE post_id=?1)",
            [ROOT],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    })?;
    assert_eq!(children, (present, present));
    check_outbox(view, CHANNEL, pending, present)
}

fn check_scope(
    view: &mut AccountHistory,
    visible: bool,
    selected: bool,
) -> Result<(), HistoryError> {
    let snapshot = view.read_sidebar(TEAM)?.unwrap();
    assert_eq!(
        snapshot.selected_channel.as_deref(),
        selected.then_some(CHANNEL)
    );
    let ids: Vec<_> = snapshot
        .data
        .channels
        .iter()
        .map(|row| row.id.as_str())
        .collect();
    let expected = if visible {
        vec![CHANNEL, NEIGHBOR, DM, GROUP]
    } else {
        vec![NEIGHBOR, DM, GROUP]
    };
    assert_eq!(ids, expected);
    assert_eq!(snapshot.data.categories[0].channel_ids, expected);
    Ok(())
}

fn seed_history(view: &mut AccountHistory) -> Result<ChannelHistoryPage, HistoryError> {
    let mut plain = page(WindowSource::Latest, &[(REPLY, 2), (ROOT, 1)]);
    let PostChange::Save(reply) = &mut plain.changes[0] else {
        unreachable!()
    };
    reply.root_id = Some(ROOT.into());
    let PostChange::Save(root) = &mut plain.changes[1] else {
        unreachable!()
    };
    root.display_priority = Some(DisplayPriority::Important);
    root.ai_attribution =
        serde_json::from_value(json!({"kind":"source","userId":BOB,"hasUsername":true})).unwrap();
    assert_eq!(apply(view, &plain)?, PageWrite::Applied);
    let mut collapsed = page(WindowSource::Latest, &[(ROOT, 1)]);
    collapsed.collapsed_threads = true;
    let PostChange::Save(post) = &mut collapsed.changes[0] else {
        unreachable!()
    };
    post.thread_summary =
        serde_json::from_value(json!({"replyCount":1,"lastReplyAt":2,"participantIds":[ALICE]}))
            .unwrap();
    post.attachments = serde_json::from_value(json!({"redactedFileCount":1})).unwrap();
    assert_eq!(apply(view, &collapsed)?, PageWrite::Applied);
    let mut neighbor_page = page(WindowSource::Latest, &[(NEIGHBOR_POST, 1)]);
    neighbor_page.channel_id = NEIGHBOR.into();
    let PostChange::Save(row) = &mut neighbor_page.changes[0] else {
        unreachable!()
    };
    row.channel_id = NEIGHBOR.into();
    assert_eq!(apply(view, &neighbor_page)?, PageWrite::Applied);
    view.write(|tx| {
        tx.execute(
            "INSERT INTO channel_profile(id,username,first_name,last_name,nickname,position,is_bot,is_guest,remote_username)
             VALUES(?1,'shared','','','','',0,0,'')",
            [BOB],
        )
    })?;
    Ok(plain)
}

pub(crate) fn round_trip(root: &Path) -> Result<(), HistoryError> {
    let root = root.join("departed-channel");
    let identity = account(URL, ALICE);
    let mut first = AccountHistory::open(&root, &identity)?;
    assert!(matches!(
        AccountHistory::open(&root, &account(URL, BOB)),
        Err(HistoryError::OwnerConflict)
    ));
    let peer = account("https://departure.example.test/other-team", BOB);
    let mut other = AccountHistory::open(&root, &peer)?;
    save_text(&mut other, CHANNEL, None, "other account")?;
    seed_sidebar(&mut first)?;
    assert!(first.select_sidebar_channel(TEAM, CHANNEL)?);
    for (team, room) in [
        (TEAM, DM),
        (TEAM, GROUP),
        (OTHER_TEAM, CHANNEL),
        (TEAM, EMPTY_EDITOR),
    ] {
        assert!(first.begin_channel_membership_update(team, room)?.is_none());
    }

    let plain = seed_history(&mut first)?;
    let pending = queue(&mut first, CHANNEL, EMPTY_EDITOR)?;
    let kept = queue(&mut first, NEIGHBOR, BOB)?;
    let old_draft = save_text(&mut first, CHANNEL, None, "room note")?;
    save_text(&mut first, CHANNEL, Some(ROOT), "thread note")?;
    let peer_revision = save_text(&mut first, NEIGHBOR, None, "keep")?;
    let empty_before = first.read_draft(CHANNEL, Some(EMPTY_EDITOR))?;
    let mut second = AccountHistory::open(&root, &identity)?;
    let early_leave = first
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    let later_member = second
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    assert!(second.finish_channel_membership_update(&later_member, true)?);
    assert!(!first.finish_channel_membership_update(&early_leave, false)?);
    let early_member = first
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    let leave = second
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    assert_eq!(
        other.finish_channel_membership_update(&leave, false),
        Err(HistoryError::StaleOwner)
    );
    let stale_sidebar = first.begin_sidebar_load(TEAM)?.unwrap();
    let before_leave = first.begin_channel_load(CHANNEL)?;
    let before_rejoin = first.begin_channel_load(CHANNEL)?;
    second.write(|tx| {
        tx.execute_batch(
            "CREATE TEMP TRIGGER fail_departure BEFORE DELETE ON pending_post
         BEGIN SELECT RAISE(ABORT,'fixture rollback'); END",
        )
    })?;
    assert_eq!(
        second.finish_channel_membership_update(&leave, false),
        Err(HistoryError::Storage)
    );
    check_departing_data(&mut first, &pending, true)?;
    check_scope(&mut first, true, true)?;
    second.write(|tx| tx.execute_batch("DROP TRIGGER fail_departure"))?;
    assert!(second.finish_channel_membership_update(&leave, false)?);
    assert!(!second.finish_channel_membership_update(&leave, false)?);
    assert!(!first.finish_channel_membership_update(&early_member, true)?);
    assert!(!first.store_sidebar(stale_sidebar, &sidebar())?);
    assert_eq!(
        first.apply_channel_window(before_leave, &plain)?,
        PageWrite::Superseded
    );
    assert_eq!(apply(&mut first, &plain)?, PageWrite::Superseded);
    let while_absent = first.begin_channel_load(CHANNEL)?;
    let absent_editor = first.read_draft(CHANNEL, Some(EMPTY_EDITOR))?;
    assert!(matches!(
        first.save_draft(
            CHANNEL,
            Some(EMPTY_EDITOR),
            absent_editor.revision.as_deref(),
            "opened after leaving"
        )?,
        DraftSave::Conflict(_)
    ));
    assert!(matches!(
        first.save_draft(CHANNEL, None, Some(&old_draft), "late")?,
        DraftSave::Conflict(_)
    ));
    assert!(matches!(
        first.save_draft(
            CHANNEL,
            Some(EMPTY_EDITOR),
            empty_before.revision.as_deref(),
            "late empty"
        )?,
        DraftSave::Conflict(_)
    ));
    assert!(!first.confirm_delivery(
        DeliverySource::Posted,
        Some(&pending),
        &receipt(CHANNEL, EMPTY_EDITOR)
    )?);
    assert!(
        first
            .retry_post(&pending, 2, RetryPost::DespiteUnknownDelivery)?
            .is_none()
    );
    drop(first);
    drop(second);

    let mut reopened = AccountHistory::open(&root, &identity)?;
    check_departing_data(&mut reopened, &pending, false)?;
    assert_eq!(other.read_draft(CHANNEL, None)?.message, "other account");
    check_scope(&mut reopened, false, false)?;
    publish_sidebar(&mut reopened)?;
    check_scope(&mut reopened, false, false)?;
    check_outbox(&mut reopened, NEIGHBOR, &kept, true)?;
    assert_eq!(
        reopened.read_draft(NEIGHBOR, None)?.revision,
        Some(peer_revision)
    );
    assert_eq!(
        reopened
            .read_latest_window(NEIGHBOR, false, 5)?
            .unwrap()
            .posts[0]
            .id,
        NEIGHBOR_POST
    );
    let username: String = reopened.read(|tx| {
        tx.query_row(
            "SELECT username FROM channel_profile WHERE id=?1",
            [BOB],
            |row| row.get(0),
        )
    })?;
    assert_eq!(username, "shared");
    assert!(
        reopened
            .begin_channel_membership_update(OTHER_TEAM, CHANNEL)?
            .is_none()
    );
    let still_absent = reopened
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    assert!(reopened.finish_channel_membership_update(&still_absent, false)?);
    assert_eq!(
        reopened.read_draft(CHANNEL, Some(EMPTY_EDITOR))?,
        absent_editor
    );
    let join = reopened
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    assert!(reopened.finish_channel_membership_update(&join, true)?);
    assert!(!reopened.finish_channel_membership_update(&leave, false)?);
    assert_eq!(
        reopened.apply_channel_window(before_rejoin, &plain)?,
        PageWrite::Superseded
    );
    assert_eq!(
        reopened.apply_channel_window(while_absent, &plain)?,
        PageWrite::Superseded
    );
    let empty_after = reopened.read_draft(CHANNEL, Some(EMPTY_EDITOR))?;
    assert!(empty_after.message.is_empty());
    assert_ne!(empty_after.revision, empty_before.revision);
    for stale in [&empty_before, &absent_editor] {
        assert!(matches!(
            reopened.save_draft(CHANNEL, Some(EMPTY_EDITOR), stale.revision.as_deref(), "")?,
            DraftSave::Conflict(actual) if actual == empty_after
        ));
    }
    assert!(matches!(
        reopened.stage_post(CHANNEL, None, &old_draft)?,
        StagePost::NotStaged { .. }
    ));
    assert!(matches!(
        reopened.save_draft(
            CHANNEL,
            Some(EMPTY_EDITOR),
            empty_before.revision.as_deref(),
            "old editor"
        )?,
        DraftSave::Conflict(_)
    ));
    save_text(&mut reopened, CHANNEL, Some(EMPTY_EDITOR), "fresh text")?;
    assert_eq!(apply(&mut reopened, &plain)?, PageWrite::Applied);
    publish_sidebar(&mut reopened)?;
    check_scope(&mut reopened, true, false)?;

    let previous_login = reopened
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    reopened.database.new_login(&identity)?;
    let mut current = AccountHistory::open(&root, &identity)?;
    assert_eq!(
        current.finish_channel_membership_update(&previous_login, false),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        current.read_draft(CHANNEL, Some(EMPTY_EDITOR))?.message,
        "fresh text"
    );
    assert!(current.read_post(ROOT)?.is_some());
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod processes {
    use super::*;
    use std::{env, process::Command};

    const CHILD_ROOT: &str = "UMMKA_TEST_CHANNEL_DEPARTURE_ROOT";

    #[test]
    fn another_process_cannot_restore_history_or_drafts_after_departure() {
        let root = tempfile::tempdir().unwrap();
        let identity = account(URL, ALICE);
        let mut first = AccountHistory::open(root.path(), &identity).unwrap();
        seed_sidebar(&mut first).unwrap();
        let page = seed_history(&mut first).unwrap();
        let revision = save_text(&mut first, CHANNEL, None, "first process").unwrap();
        let in_flight = first.begin_channel_load(CHANNEL).unwrap();
        let oldest = first
            .begin_channel_membership_update(TEAM, CHANNEL)
            .unwrap()
            .unwrap();
        let child = Command::new(env::current_exe().unwrap())
            .args([
                "--exact",
                "history::checks::departure::processes::leave_in_child",
                "--nocapture",
            ])
            .env(CHILD_ROOT, root.path())
            .output()
            .unwrap();
        assert!(
            child.status.success(),
            "{}",
            String::from_utf8_lossy(&child.stderr)
        );
        assert!(String::from_utf8_lossy(&child.stdout).contains("child confirmed departure"));
        assert!(
            !first
                .finish_channel_membership_update(&oldest, true)
                .unwrap()
        );
        assert_eq!(
            first.apply_channel_window(in_flight, &page).unwrap(),
            PageWrite::Superseded
        );
        assert!(matches!(
            first.save_draft(CHANNEL, None, Some(&revision), "late write").unwrap(),
            DraftSave::Conflict(saved) if saved.message.is_empty()
        ));
        assert!(first.read_post(ROOT).unwrap().is_none());
        assert!(first.read_post(NEIGHBOR_POST).unwrap().is_some());
    }

    #[test]
    fn leave_in_child() {
        let Some(root) = env::var_os(CHILD_ROOT) else {
            return;
        };
        let mut child = AccountHistory::open(Path::new(&root), &account(URL, ALICE)).unwrap();
        let latest = child
            .begin_channel_membership_update(TEAM, CHANNEL)
            .unwrap()
            .unwrap();
        assert!(
            child
                .finish_channel_membership_update(&latest, false)
                .unwrap()
        );
        println!("child confirmed departure");
    }
}
