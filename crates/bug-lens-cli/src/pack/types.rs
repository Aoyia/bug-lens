//! 证据包核心数据结构定义（对齐 Bug Lens Schema v1–v4 会话包与截图包格式，并保留全部未知扩展字段）。

use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// 宽松反序列化可选 u64（兼容 JSON 整数与整值浮点如 `4.0`）。
pub fn deserialize_opt_u64_lenient<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = Option::<Value>::deserialize(deserializer)?;
    let Some(val) = opt else {
        return Ok(None);
    };
    match val {
        Value::Null => Ok(None),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                return Ok(Some(u));
            }
            if let Some(f) = n.as_f64() {
                if f.is_finite() && f >= 0.0 && f.fract() == 0.0 && f <= (u64::MAX as f64) {
                    return Ok(Some(f as u64));
                }
            }
            Err(serde::de::Error::custom("invalid unsigned integer value"))
        }
        _ => Err(serde::de::Error::custom("expected unsigned integer")),
    }
}

/// 宽松反序列化 `Option<IndexMap<String, String>>`：数字/布尔转字符串，null 跳过，防止单条非字符串值导致整包解析失败。
pub fn deserialize_opt_string_map<'de, D>(
    deserializer: D,
) -> Result<Option<IndexMap<String, String>>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = Option::<Value>::deserialize(deserializer)?;
    let Some(val) = opt else {
        return Ok(None);
    };
    match val {
        Value::Null => Ok(None),
        Value::Object(obj) => {
            let mut map = IndexMap::with_capacity(obj.len());
            for (k, v) in obj {
                match v {
                    Value::String(s) => {
                        map.insert(k, s);
                    }
                    Value::Number(n) => {
                        map.insert(k, n.to_string());
                    }
                    Value::Bool(b) => {
                        map.insert(k, b.to_string());
                    }
                    Value::Null => {}
                    other => {
                        map.insert(k, other.to_string());
                    }
                }
            }
            Ok(Some(map))
        }
        _ => Ok(None),
    }
}

/// 将整数型浮点（如 `9600.0`）按 JS 风格序列化为整数 `9600`，小数保留原精度。
pub mod js_num {
    use super::*;

    pub fn serialize<S: Serializer>(val: &f64, serializer: S) -> Result<S::Ok, S::Error> {
        if val.is_finite() && val.fract() == 0.0 && val.abs() <= 9_007_199_254_740_991.0 {
            serializer.serialize_i64(*val as i64)
        } else {
            serializer.serialize_f64(*val)
        }
    }

    pub fn serialize_opt<S: Serializer>(
        val: &Option<f64>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match val {
            Some(v) => serialize(v, serializer),
            None => serializer.serialize_none(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportManifestFileEntry {
    #[serde(default, deserialize_with = "deserialize_opt_u64_lenient")]
    pub byte_length: Option<u64>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportManifest {
    pub format: Option<String>,
    #[serde(default, deserialize_with = "deserialize_opt_u64_lenient")]
    pub schema_version: Option<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub created_at_epoch_ms: Option<f64>,
    pub session_id: Option<String>,
    pub files: Option<IndexMap<String, ExportManifestFileEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub has_manifest: bool,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_warning: Option<String>,
    pub checked_count: usize,
    pub skipped_count: usize,
    pub mismatches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEnvironment {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screen: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<SessionEnvironment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interactions: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub console: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_scenes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework_states: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_media: Option<bool>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSummaryItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub elapsed_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkComponentNode {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub props: Option<IndexMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<IndexMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<IndexMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FrameworkComponentNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_target: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_path: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_line: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_component: Option<FrameworkComponentNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_component: Option<FrameworkComponentNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_chain: Option<Vec<FrameworkComponentNode>>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementDescriptor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class_names: Option<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub attributes: Option<IndexMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessible_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounding_box: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locators: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework: Option<Value>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pointer_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_trusted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionScreenshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub created_at: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub elapsed_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<InteractionInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coordinates: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element: Option<ElementDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<ElementDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<IndexMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<InteractionScreenshot>,
    /// 保留扩展字段（如 `confirmedAt` 等），确保 `--format json` 无损透传。
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMappedLocation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_line: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_column: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_function_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticStackFrame {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_mapped_location: Option<SourceMappedLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StackTraceField {
    Text(String),
    Frames(Vec<DiagnosticStackFrame>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub created_at: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_trace: Option<StackTraceField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_mapped_location: Option<SourceMappedLocation>,
    /// 保留扩展字段（如 `frameId`、`executionContextId`、`networkRequestId`）。
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRequestMeta {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub headers: Option<IndexMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkResponseMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub headers: Option<IndexMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache: Option<Value>,
    /// 保留扩展字段（如 `encodedDataLength` 等）。
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkEntry {
    #[serde(default)]
    pub id: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub created_at: Option<f64>,
    #[serde(default)]
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_text: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initiator_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<NetworkRequestMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<NetworkResponseMeta>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

impl NetworkEntry {
    /// 返回有效网络错误文本（兼容 `errorText` 与扩展真实写入的顶层 `error` 字段）。
    pub fn effective_error(&self) -> Option<&str> {
        self.error_text
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| self.error.as_deref().filter(|s| !s.is_empty()))
    }

    /// 判断网络请求是否失败（状态码 0、HTTP >= 400 或存在非空错误文本）。
    pub fn is_failure(&self) -> bool {
        let st = self.status.unwrap_or(0);
        st == 0 || st >= 400 || self.effective_error().is_some()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkDetailEntry {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub request_headers: Option<IndexMap<String, String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub response_headers: Option<IndexMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initiator: Option<Value>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AncestorSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class_names: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSceneTarget {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub captured_at_epoch_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element: Option<ElementDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sanitized_html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ancestors: Option<Vec<AncestorSummary>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<IndexMap<String, Value>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub computed_style: Option<IndexMap<String, String>>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceInteraction {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub created_at: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub offset_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceConsoleError {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub created_at: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub offset_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceNetworkFailure {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub created_at: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub offset_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceContext {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub anchor_epoch_ms: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub window_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interactions: Option<Vec<SequenceInteraction>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub console_errors: Option<Vec<SequenceConsoleError>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_failures: Option<Vec<SequenceNetworkFailure>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ExpectedField {
    Text(String),
    Structured {
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        confidence: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSceneNarrative {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<ExpectedField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reproduction_hint: Option<String>,
}

impl IssueSceneNarrative {
    pub fn resolve_expected(&self) -> (Option<String>, String) {
        match &self.expected {
            Some(ExpectedField::Text(s)) => {
                if s.is_empty() {
                    (Some(s.clone()), "missing".to_string())
                } else {
                    (Some(s.clone()), "explicit".to_string())
                }
            }
            Some(ExpectedField::Structured { text, confidence }) => {
                let conf = confidence
                    .clone()
                    .unwrap_or_else(|| "missing".to_string());
                (text.clone(), conf)
            }
            None => (None, "missing".to_string()),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSceneObject {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub observed_at_epoch_ms: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub selection_started_at_epoch_ms: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub committed_at_epoch_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence_context: Option<SequenceContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<IssueSceneTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub targets: Option<Vec<IssueSceneTarget>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotation: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub narrative: Option<IssueSceneNarrative>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issues: Option<Vec<Value>>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSceneEnvelope {
    pub scene: Option<IssueSceneObject>,
    pub id: Option<String>,
    pub original_source: Option<String>,
    pub annotated_source: Option<String>,
    pub narrative: Option<IssueSceneNarrative>,
    pub sequence_context: Option<SequenceContext>,
    pub target: Option<IssueSceneTarget>,
    pub targets: Option<Vec<IssueSceneTarget>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebStorageSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_storage: Option<IndexMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_storage: Option<IndexMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redacted_values: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkStateEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub captured_at_epoch_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<FrameworkSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub components: Option<Vec<FrameworkComponentNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub global_state: Option<IndexMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_storage: Option<WebStorageSnapshot>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTargetMeta {
    pub initial_url: Option<String>,
    pub initial_title: Option<String>,
    pub environment: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTimelineMeta {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub created_at_epoch_ms: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub started_at_epoch_ms: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub stopped_at_epoch_ms: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub duration_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<SessionTargetMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeline: Option<SessionTimelineMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<Value>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDataPayload {
    pub summary: Option<SessionSummary>,
    pub screenshot_summaries: Option<Vec<ScreenshotSummaryItem>>,
    pub protocol_version: Option<u64>,
    pub session: Option<SessionMeta>,
    pub interactions: Option<Vec<InteractionEntry>>,
    pub console_entries: Option<Vec<ConsoleEntry>>,
    pub console_logs: Option<Vec<ConsoleEntry>>,
    pub network_entries: Option<Vec<NetworkEntry>>,
    pub issue_scenes: Option<Vec<IssueSceneEnvelope>>,
    pub framework_states: Option<Vec<FrameworkStateEntry>>,
    pub has_media: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotIntentFlags {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_arrow_target: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_highlighted_focus: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_privacy_redacted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotDomAnchor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_rect: Option<Value>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub computed_styles: Option<IndexMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub box_model: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_context: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_path: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_line: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obscured_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error_signal: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub select_state: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent_flags: Option<ScreenshotIntentFlags>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotDomContextMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leaf_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ancestor_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotDomContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smallest_common_ancestor_selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<ScreenshotDomContextMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchors: Option<Vec<ScreenshotDomAnchor>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leaves: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ancestors: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotViewport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dpr: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotConsoleError {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub timestamp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotFailedRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_text: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub timestamp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotEnvironment {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<ScreenshotViewport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_breakpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_console_errors: Option<Vec<ScreenshotConsoleError>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_failed_requests: Option<Vec<ScreenshotFailedRequest>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework_component_states: Option<Vec<FrameworkComponentNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vue_component_states: Option<Vec<FrameworkComponentNode>>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeSheetSource {
    pub id: String,
    pub href: Option<String>,
    pub owner_node_tag: Option<String>,
    pub rules_count: Option<usize>,
    pub is_inline: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeRuleSource {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub sheet_id: String,
    #[serde(default)]
    pub selector_text: String,
    #[serde(default)]
    pub css_text: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub style_props: Option<IndexMap<String, String>>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeInheritedRuleRef {
    #[serde(default)]
    pub ancestor_selector: String,
    #[serde(default)]
    pub ancestor_tag_name: String,
    #[serde(default)]
    pub rule_id: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_opt_string_map"
    )]
    pub inherited_props: Option<IndexMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeElementRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub selector: String,
    #[serde(default)]
    pub tag_name: String,
    pub matched_rule_ids: Option<Vec<String>>,
    pub inherited_rules: Option<Vec<CascadeInheritedRuleRef>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeIndex {
    pub sheets: Option<Vec<CascadeSheetSource>>,
    pub rules: Option<Vec<CascadeRuleSource>>,
    pub elements: Option<Vec<CascadeElementRef>>,
    pub per_property: Option<Value>,
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFileEntryInfo {
    pub path: String,
    pub byte_length: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_media: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct SkippedMediaInfo {
    pub original_size: u64,
    pub compressed_size: u64,
}
