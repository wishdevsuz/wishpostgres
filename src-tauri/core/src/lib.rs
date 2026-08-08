//! Core PostgreSQL engine for WishPostgres.
//!
//! This crate is deliberately free of any GUI or Tauri dependency so that the
//! database layer can be compiled and tested on its own.

pub mod backup;
pub mod data;
pub mod ddl;
pub mod error;
pub mod export;
pub mod ident;
pub mod import;
pub mod introspect;
pub mod models;
pub mod pool;
pub mod query;
pub mod tls;
pub mod value;

#[cfg(test)]
pub mod testing;

/// Re-exported so the application layer needs no direct pool dependency.
pub use deadpool_postgres::Client;
pub use error::{CoreError, CoreResult, ErrorReport};
pub use models::*;
pub use pool::{ConnectionTarget, SessionKey, SessionManager};
