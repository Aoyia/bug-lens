//! CLI 统一错误类型，保持与既有错误码前缀（如 `UNKNOWN_COMMAND:`、`SCENE_NOT_FOUND:`）严格一致。

use std::fmt;

#[derive(Debug, Clone)]
pub struct CliError(pub String);

impl CliError {
    pub fn new(msg: impl Into<String>) -> Self {
        Self(msg.into())
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CliError {}

pub type CliResult<T> = Result<T, CliError>;
