//! Bug Lens 证据包本地诊断 CLI（Rust 原生实现）。
//!
//! 严格保持零外联安全不变量：仅做本地流式 ZIP 解包、完整性校验与只读查询，不引入任何网络客户端依赖。

pub mod cli;
pub mod error;
pub mod format;
pub mod pack;
pub mod query;
pub mod tools;

pub use cli::run_triage_cli;
