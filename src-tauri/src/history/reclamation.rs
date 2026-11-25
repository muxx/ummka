use super::{HistoryDatabase, HistoryError, HistoryOwner, stored_owner};
use rusqlite::{Transaction, TransactionBehavior};

impl HistoryDatabase {
    /// Revoke this login's history, drain older snapshots and return its pages to the filesystem.
    /// The session coordinator holds the credential writer while confirming an explicit sign-out.
    pub(super) fn purge(&mut self, owner: &HistoryOwner) -> Result<(), HistoryError> {
        self.reclaim(Some(owner))
    }

    pub(super) fn reclaim(&mut self, expected: Option<&HistoryOwner>) -> Result<(), HistoryError> {
        if expected.is_some_and(|owner| self.installation != owner.account.installation()) {
            return Err(HistoryError::StaleOwner);
        }
        self.connection
            .pragma_update(None, "secure_delete", "FAST")?;
        let tx = self.transaction(TransactionBehavior::Immediate)?;
        if let Some((url, user, generation)) = stored_owner(&tx)? {
            let owner = expected.ok_or(HistoryError::StaleOwner)?;
            if url != owner.account.installation()
                || user != owner.account.user_id()
                || generation != owner.generation
            {
                return Err(HistoryError::StaleOwner);
            }
            tx.execute("DELETE FROM history_owner WHERE slot = 1", [])?;
        }
        tx.commit()?;

        // A retry after the deletion must also reclaim pages and finish the WAL checkpoint.
        let tx = self.transaction(TransactionBehavior::Immediate)?;
        if stored_owner(&tx)?.is_some() {
            return Err(HistoryError::StaleOwner);
        }
        {
            let mut vacuum = tx.prepare("PRAGMA incremental_vacuum")?;
            let mut pages = vacuum.query([])?;
            while pages.next()?.is_some() {}
        }
        tx.commit()?;

        let checkpoint: (i64, i64, i64) =
            self.connection
                .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })?;
        if checkpoint != (0, 0, 0) {
            return Err(HistoryError::Storage);
        }
        self.confirm_empty()?.commit()?;
        Ok(())
    }

    fn confirm_empty(&mut self) -> Result<Transaction<'_>, HistoryError> {
        let tx = self.transaction(TransactionBehavior::Immediate)?;
        if stored_owner(&tx)?.is_some() {
            return Err(HistoryError::StaleOwner);
        }
        let free: i64 = tx.pragma_query_value(None, "freelist_count", |row| row.get(0))?;
        if free != 0 {
            return Err(HistoryError::Storage);
        }
        Ok(tx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::Account;
    use std::time::Duration;

    #[test]
    fn upgrading_a_signed_out_v13_database_preserves_its_reclaimed_pages() {
        let root = tempfile::tempdir().unwrap();
        let url = "https://chat.example.test/upgrade";
        let account = Account::new(url, "Abc01234567890123456789012").unwrap();
        let mut old =
            HistoryDatabase::open_with(root.path(), url, &crate::history::schema::MIGRATIONS[..13])
                .unwrap();
        let owner = old.new_login(&account).unwrap();
        old.write(&owner, |tx| {
            tx.execute("INSERT INTO pending_post(pending_id,login_generation,channel_id,root_id,message) VALUES ('outgoing',?1,'test','','old draft')", [owner.generation])?;
            tx.execute("INSERT INTO post_attempt(pending_id,attempt) VALUES ('outgoing',2)", [])?;
            Ok(())
        }).unwrap();
        old.purge(&owner).unwrap();
        drop(old);
        let mut upgraded = HistoryDatabase::open(root.path(), url).unwrap();
        upgraded.confirm_empty().unwrap().commit().unwrap();
        let owner = upgraded.new_login(&account).unwrap();
        let count: i64 = upgraded
            .read(&owner, |tx| {
                tx.query_row("SELECT count(*) FROM pending_post", [], |row| row.get(0))
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn new_login_waits_until_empty_history_is_confirmed() {
        let root = tempfile::tempdir().unwrap();
        let url = "https://chat.example.test/confirm";
        let account = Account::new(url, "Abc01234567890123456789012").unwrap();
        let mut first = HistoryDatabase::open(root.path(), url).unwrap();
        let mut second = HistoryDatabase::open(root.path(), url).unwrap();
        second.connection.busy_timeout(Duration::ZERO).unwrap();
        let confirmation = first.confirm_empty().unwrap();
        assert!(matches!(
            second.new_login(&account),
            Err(HistoryError::Storage)
        ));
        confirmation.commit().unwrap();
        let next = second.new_login(&account).unwrap();
        assert!(matches!(
            first.confirm_empty(),
            Err(HistoryError::StaleOwner)
        ));
        assert!(second.read(&next, |_| Ok(())).is_ok());
    }
}
