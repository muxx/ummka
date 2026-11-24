use super::*;
use tokio::sync::oneshot;

type Gate = (oneshot::Sender<()>, std::sync::mpsc::Receiver<()>);

#[derive(Default)]
pub(crate) struct TestVault {
    rows: Mutex<HashMap<Account, SessionToken>>,
    pub(crate) reads: std::sync::atomic::AtomicUsize,
    pub(crate) saves: std::sync::atomic::AtomicUsize,
    pub(crate) refuse: std::sync::atomic::AtomicBool,
    pub(crate) save_gate: Mutex<Option<Gate>>,
    pub(crate) read_gate: Mutex<Option<Gate>>,
}

impl CredentialStore for Arc<TestVault> {
    fn read(&self, a: &Account) -> Result<Option<SessionToken>, CredentialError> {
        use std::sync::atomic::Ordering::SeqCst;
        self.reads.fetch_add(1, SeqCst);
        let existing = self.rows.lock().unwrap().get(a).cloned();
        if let Some((started, release)) = self.read_gate.lock().unwrap().take() {
            started.send(()).unwrap();
            release.recv().unwrap();
        }
        Ok(existing)
    }
    fn save(&self, a: &Account, t: &SessionToken) -> Result<(), CredentialError> {
        self.saves.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if let Some((started, release)) = self.save_gate.lock().unwrap().take() {
            started.send(()).unwrap();
            release
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
        }
        if self.refuse.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialError::StorageUnavailable);
        }
        let mut rows = self.rows.lock().unwrap();
        if rows
            .keys()
            .any(|other| other.installation() == a.installation() && other != a)
        {
            return Err(CredentialError::InstallationAccountConflict);
        }
        rows.insert(a.clone(), t.clone());
        Ok(())
    }
    fn remove(&self, a: &Account) -> Result<(), CredentialError> {
        if self.refuse.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialError::StorageUnavailable);
        }
        self.rows.lock().unwrap().remove(a);
        Ok(())
    }
    fn remove_matching(
        &self,
        a: &Account,
        expected: &SessionToken,
    ) -> Result<crate::credentials::Removal, CredentialError> {
        use crate::credentials::Removal;
        if self.refuse.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CredentialError::StorageUnavailable);
        }
        let mut rows = self.rows.lock().unwrap();
        if rows
            .get(a)
            .is_some_and(|current| current.secret() != expected.secret())
        {
            return Ok(Removal::Superseded);
        }
        rows.remove(a);
        Ok(Removal::Removed)
    }
    fn account_ids(&self, base: &str) -> Result<Vec<String>, CredentialError> {
        let mut ids: Vec<_> = self
            .rows
            .lock()
            .unwrap()
            .keys()
            .filter(|a| a.installation() == base)
            .map(|a| a.user_id().to_owned())
            .collect();
        ids.sort_unstable();
        Ok(ids)
    }
}

pub(crate) fn using(vault: Arc<TestVault>) -> AccountSessions {
    AccountSessions::with_store(move || Ok(Box::new(vault.clone())))
}
