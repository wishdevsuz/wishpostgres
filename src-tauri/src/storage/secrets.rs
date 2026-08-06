//! Password storage.
//!
//! Passwords are kept in the operating system keyring (the Secret Service /
//! GNOME Keyring / KWallet on Linux) whenever one is available. When no keyring
//! can be reached — a headless session, or a desktop without a Secret Service
//! provider — the password falls back to a file encrypted with
//! XChaCha20-Poly1305 under a key derived from the machine id and a random
//! per-installation salt, stored with `0600` permissions.
//!
//! The fallback protects against casual disclosure (backups, synced dotfiles)
//! but not against an attacker who already has read access as this user; the UI
//! says so explicitly when it is in use.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{AeadCore, XChaCha20Poly1305, XNonce};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

const SERVICE: &str = "dev.wishpostgres.app";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretBackend {
    Keyring,
    EncryptedFile,
}

#[derive(Default, Serialize, Deserialize)]
struct Vault {
    salt: String,
    entries: HashMap<String, String>,
}

pub struct SecretStore {
    path: PathBuf,
    backend: Mutex<Option<SecretBackend>>,
    /// Serialises the read-modify-write of the vault so two connections saved
    /// at the same time cannot drop one another's entry.
    exclusive: Mutex<()>,
}

impl SecretStore {
    pub fn new(directory: &std::path::Path) -> Self {
        Self {
            path: directory.join("credentials.enc"),
            backend: Mutex::new(None),
            exclusive: Mutex::new(()),
        }
    }

    /// Which backend the last operation used, so the UI can tell the user where
    /// their passwords live.
    pub fn backend(&self) -> SecretBackend {
        self.backend.lock().unwrap_or(SecretBackend::Keyring)
    }

    pub fn set(&self, connection_id: &str, password: &str) -> AppResult<()> {
        match keyring_entry(connection_id).and_then(|entry| entry.set_password(password)) {
            Ok(()) => {
                *self.backend.lock() = Some(SecretBackend::Keyring);
                Ok(())
            }
            Err(_) => {
                *self.backend.lock() = Some(SecretBackend::EncryptedFile);
                self.write_fallback(connection_id, Some(password))
            }
        }
    }

    pub fn get(&self, connection_id: &str) -> AppResult<Option<String>> {
        match keyring_entry(connection_id).map(|entry| entry.get_password()) {
            Ok(Ok(password)) => {
                *self.backend.lock() = Some(SecretBackend::Keyring);
                Ok(Some(password))
            }
            Ok(Err(keyring::Error::NoEntry)) => {
                *self.backend.lock() = Some(SecretBackend::Keyring);
                self.read_fallback(connection_id)
            }
            _ => {
                *self.backend.lock() = Some(SecretBackend::EncryptedFile);
                self.read_fallback(connection_id)
            }
        }
    }

    pub fn remove(&self, connection_id: &str) -> AppResult<()> {
        if let Ok(entry) = keyring_entry(connection_id) {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => {}
            }
        }
        self.write_fallback(connection_id, None)
    }

    fn load_vault(&self) -> AppResult<Vault> {
        if !self.path.exists() {
            return Ok(Vault {
                salt: BASE64.encode(random_bytes::<32>()),
                entries: HashMap::new(),
            });
        }
        let raw = std::fs::read_to_string(&self.path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn save_vault(&self, vault: &Vault) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Created 0600 up front rather than chmod-ed afterwards: between the
        // write and the chmod the ciphertext would briefly be world readable.
        let mut file = create_private(&self.path)?;
        file.write_all(serde_json::to_string_pretty(vault)?.as_bytes())?;
        file.sync_all()?;
        Ok(())
    }

    fn write_fallback(&self, connection_id: &str, password: Option<&str>) -> AppResult<()> {
        let _guard = self.exclusive.lock();
        let mut vault = self.load_vault()?;
        match password {
            Some(secret) => {
                let cipher = cipher(&vault.salt)?;
                let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
                let sealed = cipher
                    .encrypt(&nonce, secret.as_bytes())
                    .map_err(|_| AppError::secret("the password could not be encrypted"))?;
                let mut payload = nonce.to_vec();
                payload.extend_from_slice(&sealed);
                vault
                    .entries
                    .insert(connection_id.to_string(), BASE64.encode(payload));
            }
            None => {
                vault.entries.remove(connection_id);
            }
        }
        self.save_vault(&vault)
    }

    fn read_fallback(&self, connection_id: &str) -> AppResult<Option<String>> {
        let vault = self.load_vault()?;
        let Some(encoded) = vault.entries.get(connection_id) else {
            return Ok(None);
        };

        let payload = BASE64
            .decode(encoded)
            .map_err(|_| AppError::secret("the stored password is corrupt"))?;
        if payload.len() <= 24 {
            return Err(AppError::secret("the stored password is corrupt"));
        }

        let (nonce, sealed) = payload.split_at(24);
        let cipher = cipher(&vault.salt)?;
        let plain = cipher
            .decrypt(XNonce::from_slice(nonce), sealed)
            .map_err(|_| {
                AppError::secret(
                    "the stored password could not be decrypted on this machine — re-enter it",
                )
            })?;

        Ok(Some(String::from_utf8(plain).map_err(|_| {
            AppError::secret("the stored password is not valid text")
        })?))
    }
}

fn keyring_entry(connection_id: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, connection_id)
}

fn cipher(salt: &str) -> AppResult<XChaCha20Poly1305> {
    let mut hasher = Sha256::new();
    hasher.update(machine_identity().as_bytes());
    hasher.update(b"wishpostgres-credential-vault-v1");
    hasher.update(salt.as_bytes());
    let key = hasher.finalize();
    XChaCha20Poly1305::new_from_slice(&key)
        .map_err(|_| AppError::secret("the encryption key could not be derived"))
}

/// A value that is stable for this machine and user but not secret in itself;
/// the random per-installation salt supplies the entropy.
fn machine_identity() -> String {
    let machine = std::fs::read_to_string("/etc/machine-id")
        .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
        .unwrap_or_default();
    let user = std::env::var("USER").unwrap_or_default();
    format!("{}:{}", machine.trim(), user)
}

fn random_bytes<const N: usize>() -> [u8; N] {
    use rand::RngCore;
    let mut buffer = [0u8; N];
    rand::rngs::OsRng.fill_bytes(&mut buffer);
    buffer
}

/// Open `path` for writing, truncated, readable and writable only by this user.
#[cfg(unix)]
fn create_private(path: &std::path::Path) -> AppResult<std::fs::File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    // `mode` only applies when the file is created, so tighten an existing one
    // that a previous version may have left readable.
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    Ok(file)
}

#[cfg(not(unix))]
fn create_private(path: &std::path::Path) -> AppResult<std::fs::File> {
    Ok(std::fs::File::create(path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_the_encrypted_fallback() {
        let directory = std::env::temp_dir().join(format!("pgl-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let store = SecretStore::new(&directory);

        store.write_fallback("conn-1", Some("s3cr3t")).unwrap();
        assert_eq!(
            store.read_fallback("conn-1").unwrap(),
            Some("s3cr3t".to_string())
        );

        store.write_fallback("conn-1", None).unwrap();
        assert_eq!(store.read_fallback("conn-1").unwrap(), None);

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn missing_entries_return_none() {
        let directory = std::env::temp_dir().join(format!("pgl-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let store = SecretStore::new(&directory);
        assert_eq!(store.read_fallback("absent").unwrap(), None);
        std::fs::remove_dir_all(&directory).ok();
    }
}
