import { useState, useEffect, useCallback } from "preact/hooks";
import {
  getDiagnosticsData,
  clearDiagnosticsData,
  captureMemorySnapshot,
  enrichDiagnosticsWithSessionOverviews,
  type DiagnosticsData,
  type TaskProfile,
} from "../../diagnostics/diagnostics-store";
import {
  buildDiagnosticsZipArchive,
  downloadDiagnosticsZipAndResolvePath,
  buildDiagnosticsAiPrompt,
} from "../../diagnostics/diagnostics-zip-builder";
import { isEn } from "../../shared/i18n";
import { copyTextToClipboard } from "../../preview/clipboard";
import {
  message,
  type SessionOverview,
  type StorageOverview,
} from "../../shared/protocol";

function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  return `${minutes}m ${remainingSecs}s`;
}

function formatBytesShort(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function DiagnosticsTab() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [storageOverview, setStorageOverview] = useState<
    StorageOverview | undefined
  >(undefined);
  const [sessionOverviews, setSessionOverviews] = useState<
    SessionOverview[] | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [actionStatus, setActionStatus] = useState<string>("");
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(
    null
  );
  const [showFlightLogs, setShowFlightLogs] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let res = await getDiagnosticsData();
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        try {
          const [stRes, sessRes] = await Promise.all([
            chrome.runtime
              .sendMessage(message("storage/get", undefined))
              .catch(() => undefined) as Promise<
              | {
                  ok?: boolean;
                  storage?: StorageOverview;
                  overview?: StorageOverview;
                }
              | undefined
            >,
            chrome.runtime
              .sendMessage(message("session/list", undefined))
              .catch(() => undefined) as Promise<
              { ok?: boolean; sessions?: SessionOverview[] } | undefined
            >,
          ]);
          const resolvedStorage = stRes?.storage ?? stRes?.overview;
          if (stRes?.ok && resolvedStorage) {
            setStorageOverview(resolvedStorage);
          }
          if (sessRes?.ok && Array.isArray(sessRes.sessions)) {
            setSessionOverviews(sessRes.sessions);
            res = enrichDiagnosticsWithSessionOverviews(res, sessRes.sessions);
          }
        } catch {
          // 忽略
        }
      }
      setData(res);
    } catch {
      // 忽略
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleExportFullZipAndCopyPrompt = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      let latestData = await getDiagnosticsData();
      let latestStorage = storageOverview;
      let latestSessions = sessionOverviews;

      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        try {
          const [stRes, sessRes] = await Promise.all([
            chrome.runtime
              .sendMessage(message("storage/get", undefined))
              .catch(() => undefined) as Promise<
              | {
                  ok?: boolean;
                  storage?: StorageOverview;
                  overview?: StorageOverview;
                }
              | undefined
            >,
            chrome.runtime
              .sendMessage(message("session/list", undefined))
              .catch(() => undefined) as Promise<
              { ok?: boolean; sessions?: SessionOverview[] } | undefined
            >,
          ]);
          const resolvedStorage = stRes?.storage ?? stRes?.overview;
          if (stRes?.ok && resolvedStorage) {
            latestStorage = resolvedStorage;
            setStorageOverview(resolvedStorage);
          }
          if (sessRes?.ok && Array.isArray(sessRes.sessions)) {
            latestSessions = sessRes.sessions;
            setSessionOverviews(sessRes.sessions);
          }
        } catch {
          // 忽略
        }
      }

      if (latestSessions && latestSessions.length > 0) {
        latestData = enrichDiagnosticsWithSessionOverviews(
          latestData,
          latestSessions
        );
      }
      setData(latestData);

      const zipResult = buildDiagnosticsZipArchive(
        latestData,
        latestStorage,
        latestSessions
      );
      const { absolutePath } =
        await downloadDiagnosticsZipAndResolvePath(zipResult);
      const aiPrompt = buildDiagnosticsAiPrompt(
        latestData,
        zipResult.filename,
        absolutePath
      );
      await copyTextToClipboard(aiPrompt);

      const sizeText = formatBytesShort(zipResult.bytes.byteLength);
      setActionStatus(
        isEn()
          ? `Downloaded ${zipResult.filename} (${sizeText}) & copied AI prompt!`
          : `已下载全量诊断包 (${sizeText}) 并复制 AI 诊断指令到剪贴板`
      );
      window.setTimeout(() => setActionStatus(""), 4500);
    } catch (err) {
      setActionStatus(String(err));
    } finally {
      setExporting(false);
    }
  };

  const handleCopySingleProfile = async (p: TaskProfile, e: MouseEvent) => {
    e.stopPropagation();
    try {
      await copyTextToClipboard(JSON.stringify(p, null, 2));
      setActionStatus(
        isEn()
          ? `Copied profile ${p.id} JSON`
          : `已复制任务 ${p.id} 的全量黑匣子 JSON`
      );
      window.setTimeout(() => setActionStatus(""), 2500);
    } catch (err) {
      setActionStatus(String(err));
    }
  };

  const handleClearData = async () => {
    const confirmText = isEn()
      ? "Are you sure you want to clear all diagnostics records?"
      : "确定要清空所有性能与诊断记录吗？";
    if (typeof window !== "undefined" && !window.confirm(confirmText)) {
      return;
    }
    await clearDiagnosticsData();
    await loadData();
    setActionStatus(
      isEn() ? "Diagnostics data cleared" : "本地黑匣子诊断数据已清空"
    );
    window.setTimeout(() => setActionStatus(""), 2000);
  };

  const metrics = data?.metrics;
  const expStats = metrics?.exportLatencyStats;
  const shotStats = metrics?.screenshotLatencyStats;
  const profiles = data?.recentProfiles
    ? [...data.recentProfiles].reverse()
    : [];
  const flightLogs = data?.flightRecorderLogs
    ? [...data.flightRecorderLogs].reverse()
    : [];
  const mem = captureMemorySnapshot();

  return (
    <div
      className="diagnostics-panel"
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {/* 顶部工具操作条 */}
      <div
        className="settings-card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 20px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--ink-main)",
            }}
          >
            {isEn()
              ? "Full Blackbox Diagnostics & Pipeline Telemetry"
              : "全量黑匣子性能水位与运行诊断中心"}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
            {isEn()
              ? "100% raw lossless local storage (up to 200 task profiles + 1000 flight logs). Exports structured ZIP with O(1) AI workspace prompt."
              : "100% 原始无损本地保留（200 条全量任务黑匣子 + 1000 条跨进程异常日志）。一键导出分层 ZIP 诊断包并复制 AI 路径指令。"}
          </span>
          {(mem || storageOverview) && (
            <div
              style={{
                display: "flex",
                gap: 14,
                fontSize: 11,
                color: "var(--ink-sub)",
                marginTop: 2,
              }}
            >
              {mem && (
                <span>
                  JS Heap: <b>{formatBytesShort(mem.usedJSHeapBytes)}</b> /{" "}
                  {formatBytesShort(mem.jsHeapLimitBytes)}
                </span>
              )}
              {storageOverview && (
                <span>
                  IndexedDB:{" "}
                  <b>{formatBytesShort(storageOverview.usedBytes)}</b> (
                  {storageOverview.sessionCount} sessions)
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {actionStatus && (
            <span
              style={{
                fontSize: 12,
                color: "var(--primary)",
                fontWeight: 500,
              }}
            >
              {actionStatus}
            </span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => void loadData()}
            disabled={loading}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              background: "var(--bg-search)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
            }}
          >
            {isEn() ? "Refresh" : "刷新"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void handleExportFullZipAndCopyPrompt()}
            disabled={exporting}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              background: "var(--primary)",
              border: "1px solid var(--primary)",
              color: "#ffffff",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              fontWeight: 600,
              boxShadow: "0 1px 2px rgba(26, 115, 232, 0.25)",
            }}
          >
            {exporting
              ? isEn()
                ? "Packaging ZIP..."
                : "正在打包诊断 ZIP..."
              : isEn()
                ? "Export Diagnostics ZIP & Copy AI Prompt"
                : "导出全量诊断包 (.zip) 并复制 AI 指令"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void handleClearData()}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              background: "transparent",
              border: "1px solid var(--danger)",
              color: "var(--danger)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
            }}
          >
            {isEn() ? "Clear Records" : "清空记录"}
          </button>
        </div>
      </div>

      {/* 宏观指标与分位数卡片群 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
          gap: 12,
        }}
      >
        <div className="settings-card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-muted)",
              marginBottom: 4,
            }}
          >
            {isEn() ? "Total Recordings" : "累计录制次数"}
          </div>
          <div
            style={{ fontSize: 20, fontWeight: 700, color: "var(--ink-main)" }}
          >
            {metrics?.totalRecordings ?? 0}
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: "var(--ink-muted)",
                marginLeft: 6,
              }}
            >
              ({formatDuration(metrics?.totalRecordingDurationMs ?? 0)})
            </span>
          </div>
        </div>

        <div className="settings-card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-muted)",
              marginBottom: 4,
            }}
          >
            {isEn() ? "Total Screenshots" : "累计截图次数"}
          </div>
          <div
            style={{ fontSize: 20, fontWeight: 700, color: "var(--ink-main)" }}
          >
            {metrics?.totalScreenshots ?? 0}
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: "var(--ink-muted)",
                marginLeft: 6,
              }}
            >
              (Prompt: {metrics?.totalPromptCopies ?? 0})
            </span>
          </div>
        </div>

        <div className="settings-card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-muted)",
              marginBottom: 4,
            }}
          >
            {isEn() ? "Export Latency (Avg / P95)" : "录制导出耗时 (Avg / P95)"}
          </div>
          <div
            style={{ fontSize: 18, fontWeight: 700, color: "var(--ink-main)" }}
          >
            {expStats?.count
              ? `${expStats.avgMs} / ${expStats.p95Ms} ms`
              : metrics?.avgExportDurationMs
                ? `${metrics.avgExportDurationMs} ms`
                : "-"}
          </div>
          {expStats && expStats.count > 0 && (
            <div
              style={{
                fontSize: 10.5,
                color: "var(--ink-muted)",
                marginTop: 2,
              }}
            >
              P50: {expStats.p50Ms}ms | Max: {expStats.maxMs}ms
            </div>
          )}
        </div>

        <div className="settings-card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-muted)",
              marginBottom: 4,
            }}
          >
            {isEn()
              ? "Screenshot Latency (Avg / P95)"
              : "智能截图耗时 (Avg / P95)"}
          </div>
          <div
            style={{ fontSize: 18, fontWeight: 700, color: "var(--ink-main)" }}
          >
            {shotStats?.count
              ? `${shotStats.avgMs} / ${shotStats.p95Ms} ms`
              : "-"}
          </div>
          {shotStats && shotStats.count > 0 && (
            <div
              style={{
                fontSize: 10.5,
                color: "var(--ink-muted)",
                marginTop: 2,
              }}
            >
              P50: {shotStats.p50Ms}ms | Max: {shotStats.maxMs}ms
            </div>
          )}
        </div>

        <div className="settings-card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-muted)",
              marginBottom: 4,
            }}
          >
            {isEn() ? "Errors & Flight Logs" : "失败任务与黑匣子告警"}
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color:
                (metrics?.failedTasksCount ?? 0) > 0
                  ? "var(--danger)"
                  : "var(--success)",
            }}
          >
            {metrics?.failedTasksCount ?? 0} 失败 / {flightLogs.length} 日志
          </div>
          <div
            style={{ fontSize: 10.5, color: "var(--ink-muted)", marginTop: 2 }}
          >
            微操作采样: {metrics?.totalMicroOpsRecorded ?? 0} 条
          </div>
        </div>
      </div>

      {/* 跨进程 Flight Recorder 异常与告警日志面板（按需展开） */}
      {flightLogs.length > 0 && (
        <div className="settings-card" style={{ padding: "14px 20px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
            }}
            onClick={() => setShowFlightLogs(!showFlightLogs)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-main)",
                }}
              >
                {isEn()
                  ? `Internal Flight Recorder Logs (${flightLogs.length} / Max 1000)`
                  : `跨进程内部告警与异常日志 (${flightLogs.length} / 上限 1000 条)`}
              </span>
            </div>
            <span style={{ fontSize: 12, color: "var(--primary)" }}>
              {showFlightLogs
                ? isEn()
                  ? "Hide Logs"
                  : "收起日志"
                : isEn()
                  ? "Expand Logs"
                  : "展开查看"}
            </span>
          </div>

          {showFlightLogs && (
            <div
              style={{
                marginTop: 12,
                maxHeight: 280,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {flightLogs.slice(0, 100).map((log) => (
                <div
                  key={log.id}
                  style={{
                    fontSize: 11.5,
                    fontFamily: "monospace",
                    padding: "6px 10px",
                    borderRadius: 4,
                    background:
                      log.level === "warn"
                        ? "rgba(250, 140, 22, 0.08)"
                        : "rgba(217, 48, 37, 0.08)",
                    color: log.level === "warn" ? "#d46b08" : "var(--danger)",
                  }}
                >
                  <div>
                    <b>[{formatTimestamp(log.timestamp)}]</b> [{log.process}:
                    {log.level.toUpperCase()}]{" "}
                    {log.code ? `(${log.code}) ` : ""}
                    {log.message}
                  </div>
                  {log.stack && (
                    <pre
                      style={{
                        margin: "4px 0 0 0",
                        fontSize: 10.5,
                        whiteSpace: "pre-wrap",
                        color: "var(--ink-sub)",
                      }}
                    >
                      {log.stack}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 最近 200 次任务全量黑匣子 Profile 明细卡片 */}
      <div className="settings-card" style={{ padding: "16px 20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-main)" }}
          >
            {isEn()
              ? "Recent Full Task Profiles (Max 200)"
              : "最近任务全量黑匣子流水（上限 200 条）"}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
            {isEn()
              ? `Loaded ${profiles.length} profiles`
              : `已收录 ${profiles.length} 条全量记录`}
          </span>
        </div>

        {profiles.length === 0 ? (
          <div
            style={{
              padding: "36px 0",
              textAlign: "center",
              color: "var(--ink-muted)",
              fontSize: 12.5,
            }}
          >
            {isEn()
              ? "No profiling data yet. Start recording or taking screenshots to generate blackbox metrics."
              : "暂无性能数据。开始一次录制或截图即可生成全量黑匣子诊断数据。"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {profiles.map((p) => {
              const isExpanded = expandedProfileId === p.id;
              const isRec = p.taskType === "recording";
              const isDegraded =
                p.status === "success" &&
                p.qualitySummary &&
                p.qualitySummary.overall !== "complete";
              const displayWallMs = p.pipelineWallClockMs ?? p.durationMs;

              return (
                <div
                  key={p.id}
                  style={{
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-search)",
                    padding: "10px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      userSelect: "none",
                      gap: 8,
                    }}
                    onClick={() =>
                      setExpandedProfileId(isExpanded ? null : p.id)
                    }
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontWeight: 600,
                          background:
                            p.status === "error"
                              ? "rgba(217, 48, 37, 0.12)"
                              : isDegraded
                                ? "rgba(250, 140, 22, 0.14)"
                                : "var(--success-light)",
                          color:
                            p.status === "error"
                              ? "var(--danger)"
                              : isDegraded
                                ? "#d46b08"
                                : "var(--success)",
                        }}
                      >
                        {p.status === "error"
                          ? "ERROR"
                          : isDegraded
                            ? "DEGRADED"
                            : "SUCCESS"}
                      </span>

                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--ink-main)",
                        }}
                      >
                        {isRec
                          ? isEn()
                            ? "Recording"
                            : "视频录制"
                          : isEn()
                            ? "Screenshot"
                            : "智能截图"}
                      </span>

                      {isRec && p.context.sourceType && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "1px 5px",
                            borderRadius: 3,
                            background: "rgba(0,0,0,0.06)",
                            color: "var(--ink-sub)",
                          }}
                        >
                          {p.context.sourceType === "tab"
                            ? "Tab 录制"
                            : "桌面/窗口"}
                        </span>
                      )}

                      {isRec && (p.context.tabCount ?? 1) > 1 && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "1px 5px",
                            borderRadius: 3,
                            background: "rgba(26,115,232,0.1)",
                            color: "var(--primary)",
                          }}
                        >
                          多标签 ({p.context.tabCount} tabs / 切{" "}
                          {p.context.tabSwitchCount ?? 0} 次)
                        </span>
                      )}

                      {p.bottleneckStage && (
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: "1px 6px",
                            borderRadius: 3,
                            background: "rgba(114, 46, 209, 0.08)",
                            color: "#722ed1",
                            fontWeight: 500,
                          }}
                        >
                          瓶颈: {p.bottleneckStage}
                        </span>
                      )}

                      <span
                        style={{ fontSize: 11.5, color: "var(--ink-muted)" }}
                      >
                        {formatTimestamp(p.timestamp)}
                      </span>

                      {p.context.targetUrl && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--ink-sub)",
                            maxWidth: 280,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={p.context.targetUrl}
                        >
                          {p.context.targetUrl}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexShrink: 0,
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => void handleCopySingleProfile(p, e)}
                        style={{
                          fontSize: 11,
                          padding: "2px 7px",
                          background: "rgba(0,0,0,0.04)",
                          border: "1px solid var(--border-color)",
                          borderRadius: 4,
                          cursor: "pointer",
                          color: "var(--ink-sub)",
                        }}
                      >
                        {isEn() ? "Copy JSON" : "复制单条"}
                      </button>
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          fontFamily: "monospace",
                          color: "var(--ink-main)",
                        }}
                      >
                        {formatMs(displayWallMs)}
                      </span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        style={{
                          transform: isExpanded ? "rotate(90deg)" : "none",
                          transition: "transform 0.15s ease",
                          color: "var(--ink-muted)",
                        }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>

                  {/* 展开的全量黑匣子详情 */}
                  {isExpanded && (
                    <div
                      style={{
                        paddingTop: 10,
                        marginTop: 4,
                        borderTop: "1px dashed var(--border-color)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        fontSize: 11.5,
                        color: "var(--ink-sub)",
                      }}
                    >
                      {/* 1. 阶段耗时细分 */}
                      {p.breakdown && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 12,
                            background: "rgba(255,255,255,0.6)",
                            padding: "8px 10px",
                            borderRadius: 4,
                          }}
                        >
                          {isRec ? (
                            <>
                              <span>
                                录制时长: <b>{formatMs(p.durationMs)}</b>
                              </span>
                              {p.breakdown.stage1_ipcDispatchMs !==
                                undefined && (
                                <span>
                                  Stage1 IPC:{" "}
                                  <b>
                                    {p.breakdown.stage1_ipcDispatchMs.toFixed(
                                      1
                                    )}{" "}
                                    ms
                                  </b>
                                </span>
                              )}
                              {p.breakdown.stage2_cdpDrainMs !== undefined && (
                                <span>
                                  Stage2 CDP排空:{" "}
                                  <b>
                                    {p.breakdown.stage2_cdpDrainMs.toFixed(1)}{" "}
                                    ms
                                  </b>
                                </span>
                              )}
                              {p.breakdown.stage3_assemblyMs !== undefined && (
                                <span>
                                  Stage3 组装:{" "}
                                  <b>
                                    {p.breakdown.stage3_assemblyMs.toFixed(1)}{" "}
                                    ms
                                  </b>
                                  {(p.breakdown.stage3_idbReadMs !==
                                    undefined ||
                                    p.breakdown.stage3_sourceMapMs !==
                                      undefined) && (
                                    <span style={{ color: "var(--ink-muted)" }}>
                                      {" "}
                                      (IDB:{" "}
                                      {(
                                        p.breakdown.stage3_idbReadMs ?? 0
                                      ).toFixed(1)}
                                      ms / SourceMap:{" "}
                                      {(
                                        p.breakdown.stage3_sourceMapMs ?? 0
                                      ).toFixed(1)}
                                      ms)
                                    </span>
                                  )}
                                </span>
                              )}
                              {p.breakdown.stage4_zipPackMs !== undefined && (
                                <span>
                                  Stage4 ZIP封包:{" "}
                                  <b>
                                    {p.breakdown.stage4_zipPackMs.toFixed(1)} ms
                                  </b>
                                </span>
                              )}
                              {p.breakdown.stage5_browserDownloadMs !==
                                undefined && (
                                <span>
                                  Stage5 落盘:{" "}
                                  <b>
                                    {p.breakdown.stage5_browserDownloadMs.toFixed(
                                      1
                                    )}{" "}
                                    ms
                                  </b>
                                </span>
                              )}
                              {p.breakdown.stage6_feedbackMs !== undefined && (
                                <span>
                                  Stage6 终端反馈:{" "}
                                  <b>
                                    {p.breakdown.stage6_feedbackMs.toFixed(1)}{" "}
                                    ms
                                  </b>
                                </span>
                              )}
                              {p.breakdown.unaccountedOverheadMs !==
                                undefined && (
                                <span>
                                  未记账损耗:{" "}
                                  <b>
                                    {p.breakdown.unaccountedOverheadMs.toFixed(
                                      1
                                    )}{" "}
                                    ms
                                  </b>
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              {p.breakdown.imageRenderMs !== undefined && (
                                <span>
                                  图像渲染:{" "}
                                  <b>{p.breakdown.imageRenderMs} ms</b>
                                </span>
                              )}
                              {p.breakdown.domCaptureMs !== undefined && (
                                <span>
                                  DOM与框架探针:{" "}
                                  <b>{p.breakdown.domCaptureMs} ms</b>
                                </span>
                              )}
                              {p.breakdown.styleSourceMs !== undefined && (
                                <span>
                                  CSS级联与CDP行号:{" "}
                                  <b>{p.breakdown.styleSourceMs} ms</b>
                                </span>
                              )}
                              {p.breakdown.zipPackMs !== undefined && (
                                <span>
                                  ZIP封包下载: <b>{p.breakdown.zipPackMs} ms</b>
                                </span>
                              )}
                              {p.breakdown.promptFormatMs !== undefined && (
                                <span>
                                  Prompt写入:{" "}
                                  <b>{p.breakdown.promptFormatMs} ms</b>
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {/* 2. 算法与 I/O 效率指标（若包含 exportDashboard） */}
                      {p.exportDashboard?.efficiencyMetrics &&
                        p.exportDashboard.efficiencyMetrics.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 600,
                                color: "var(--ink-main)",
                              }}
                            >
                              核心算法与 I/O 效率看板:
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns:
                                  "repeat(auto-fit, minmax(220px, 1fr))",
                                gap: 6,
                              }}
                            >
                              {p.exportDashboard.efficiencyMetrics.map(
                                (em, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      background: "rgba(255,255,255,0.5)",
                                      padding: "4px 8px",
                                      borderRadius: 4,
                                      fontSize: 11,
                                    }}
                                  >
                                    <b>{em.dimension}:</b> {em.value}{" "}
                                    <span style={{ color: "var(--ink-muted)" }}>
                                      ({em.details})
                                    </span>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )}

                      {/* 3. 截图详情或录制质量摘要 */}
                      {p.screenshotDetail && (
                        <div style={{ fontSize: 11, color: "var(--ink-sub)" }}>
                          DOM节点数:{" "}
                          <b>{p.screenshotDetail.domNodesCount ?? 0}</b> |
                          框架组件数:{" "}
                          <b>
                            {p.screenshotDetail.frameworkComponentsCount ?? 0}
                          </b>{" "}
                          | CSS级联元素:{" "}
                          <b>{p.screenshotDetail.cascadeElementsCount ?? 0}</b>{" "}
                          | 批注数:{" "}
                          <b>{p.screenshotDetail.annotationCount ?? 0}</b> |
                          视口: {p.screenshotDetail.viewport?.width}×
                          {p.screenshotDetail.viewport?.height} (DPR{" "}
                          {p.screenshotDetail.dpr})
                        </div>
                      )}

                      {p.qualitySummary && (
                        <div style={{ fontSize: 11, color: "var(--ink-sub)" }}>
                          质量评级: <b>{p.qualitySummary.overall}</b> | 交互数:{" "}
                          <b>{p.qualitySummary.interactionCount}</b> |
                          截图(主通道/降级/失败):{" "}
                          <b>
                            {p.qualitySummary.primaryScreenshotCount} /{" "}
                            {p.qualitySummary.fallbackScreenshotCount} /{" "}
                            {p.qualitySummary.unavailableScreenshotCount}
                          </b>{" "}
                          | Console: <b>{p.qualitySummary.consoleEntryCount}</b>{" "}
                          | Network: <b>{p.qualitySummary.networkEntryCount}</b>
                        </div>
                      )}

                      {/* 4. 录制期高频微操作摘要 */}
                      {p.microOps && p.microOps.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              color: "var(--ink-main)",
                            }}
                          >
                            任务内微操作时间线 ({p.microOps.length}{" "}
                            条记录，展示最慢 Top 8):
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                            }}
                          >
                            {[...p.microOps]
                              .sort((a, b) => b.durationMs - a.durationMs)
                              .slice(0, 8)
                              .map((op) => (
                                <span
                                  key={op.id}
                                  style={{
                                    fontSize: 10.5,
                                    fontFamily: "monospace",
                                    padding: "2px 6px",
                                    borderRadius: 3,
                                    background:
                                      op.status === "error"
                                        ? "rgba(217,48,37,0.1)"
                                        : op.status === "degraded"
                                          ? "rgba(250,140,22,0.12)"
                                          : "rgba(0,0,0,0.05)",
                                  }}
                                >
                                  [{op.category}:{op.name}] {op.durationMs}ms (
                                  {op.status})
                                </span>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* 5. 采集期异常告警与致命错误 */}
                      {p.qualitySummary?.issues &&
                        p.qualitySummary.issues.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            {p.qualitySummary.issues.map((iss, idx) => (
                              <div
                                key={idx}
                                style={{
                                  background: "rgba(250, 140, 22, 0.1)",
                                  padding: "4px 8px",
                                  borderRadius: 4,
                                  color: "#d46b08",
                                  fontFamily: "monospace",
                                  fontSize: 11,
                                }}
                              >
                                [{iss.source}:{iss.code}] {iss.message}
                              </div>
                            ))}
                          </div>
                        )}

                      {p.error && (
                        <div
                          style={{
                            background: "rgba(217,48,37,0.08)",
                            padding: "6px 10px",
                            borderRadius: 4,
                            color: "var(--danger)",
                            fontFamily: "monospace",
                            fontSize: 11,
                          }}
                        >
                          <div>
                            [{p.error.code}] {p.error.message}
                          </div>
                          {p.error.stack && (
                            <pre
                              style={{
                                margin: "4px 0 0 0",
                                fontSize: 10.5,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {p.error.stack}
                            </pre>
                          )}
                        </div>
                      )}

                      <div
                        style={{ fontSize: 10.5, color: "var(--ink-muted)" }}
                      >
                        任务 ID: <code>{p.id}</code> | 平台:{" "}
                        {p.context.platform} | 扩展版本: v
                        {p.context.extensionVersion}
                        {p.metricsSummary?.producedBytes ? (
                          <span>
                            {" "}
                            | 产物体积:{" "}
                            {formatBytesShort(p.metricsSummary.producedBytes)}
                          </span>
                        ) : null}
                        {p.metricsSummary?.throughputMBps ? (
                          <span>
                            {" "}
                            | ZIP吞吐: {p.metricsSummary.throughputMBps} MB/s
                          </span>
                        ) : null}
                        {p.memorySnapshot ? (
                          <span>
                            {" "}
                            | 任务时JS堆:{" "}
                            {formatBytesShort(p.memorySnapshot.usedJSHeapBytes)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
