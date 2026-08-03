import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import type { IssueScenePreview } from "../../preview/issue-scene-view";
import { renderFrameworkSnapshot } from "../../preview/framework-view";

export interface IssueSceneTabProps {
  collection: { all: IssueScenePreview[]; included: IssueScenePreview[] };
  startedAtEpochMs?: number;
  editable: boolean;
  onExclude?: (id: string) => Promise<void> | void;
  onSeekVideo?: (timestampMs: number) => void;
  onNotify?: (message: string) => void;
}

export const IssueSceneTab = memo(function IssueSceneTab({
  collection,
  startedAtEpochMs,
  editable,
  onExclude,
  onSeekVideo,
}: IssueSceneTabProps) {
  const [imageMode, setImageMode] = useState<
    Record<string, "original" | "annotated">
  >({});

  if (collection.included.length === 0) {
    const isExcludedAll = collection.all.length > 0 && editable;
    const title = isExcludedAll ? "所有问题现场均已排除" : "尚未标记问题现场";
    const desc = isExcludedAll
      ? "可点击右上角“恢复问题现场”按钮恢复已被排除的现场记录"
      : "录制过程中可对关键界面进行标注截取，标记的现场将在此直观呈报";

    return (
      <div className="issue-scenes-empty">
        <div className="issue-scenes-empty-icon">
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="32" cy="32" r="32" fill="#F7F8FA" />
            <circle cx="32" cy="32" r="20" fill="#E8F3FF" />
            <path
              d="M24 18H20C18.8954 18 18 18.8954 18 20V24M40 18H44C45.1046 18 46 18.8954 46 20V24M24 46H20C18.8954 46 18 45.1046 18 44V40M40 46H44C45.1046 46 46 45.1046 46 44V40"
              stroke="#165DFF"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle cx="32" cy="32" r="4" fill="#165DFF" />
            <circle
              cx="32"
              cy="32"
              r="9"
              stroke="#165DFF"
              stroke-width="1.5"
              stroke-dasharray="2 2"
            />
          </svg>
        </div>
        <div className="issue-scenes-empty-title">{title}</div>
        <div className="issue-scenes-empty-desc">{desc}</div>
      </div>
    );
  }

  return (
    <>
      {collection.included.map((item) => {
        const scene = item.scene;
        const currentMode = imageMode[scene.id] || "annotated";
        const image =
          currentMode === "original"
            ? item.originalSource
            : item.annotatedSource || item.originalSource;
        const hasToggle = Boolean(item.annotatedSource && item.originalSource);

        const description = scene.narrative;
        const status =
          scene.status === "complete"
            ? "完成"
            : scene.status === "partial"
              ? "部分完成"
              : scene.status === "failed"
                ? "失败"
                : "草稿";
        const dom =
          scene.target.sanitizedHtml || `<${scene.target.element.tagName}>`;

        const locators = scene.target.element.locators || [];
        const bestLocator = locators[0];

        const ancestors = scene.target.ancestors || [];
        const ancestorItems = ancestors
          .slice()
          .reverse()
          .map((anc) => {
            const idStr = anc.id ? `#${anc.id}` : "";
            const clsStr =
              anc.classNames
                ?.slice(0, 2)
                .map((c) => `.${c}`)
                .join("") || "";
            return `${anc.tagName}${idStr}${clsStr}`;
          });
        const elId = scene.target.element.id
          ? `#${scene.target.element.id}`
          : "";
        const elCls =
          scene.target.element.classNames
            ?.slice(0, 2)
            .map((c) => `.${c}`)
            .join("") || "";
        ancestorItems.push(`${scene.target.element.tagName}${elId}${elCls}`);

        const vueSnapshotMarkup = renderFrameworkSnapshot(
          scene.target.element.framework
        );

        return (
          <article
            key={scene.id}
            className="issue-scene-card"
            data-issue-scene-id={scene.id}
          >
            <div className="issue-scene-card-header">
              <div>
                <span className="issue-scene-kicker">问题现场</span>
                <strong>
                  {new Date(scene.observedAtEpochMs).toLocaleTimeString()}
                </strong>
                <span className={`issue-scene-status ${scene.status}`}>
                  {status}
                </span>
              </div>
              <div className="issue-scene-actions">
                {hasToggle && (
                  <button
                    className="ghost"
                    onClick={() => {
                      setImageMode((prev) => ({
                        ...prev,
                        [scene.id]:
                          currentMode === "original" ? "annotated" : "original",
                      }));
                    }}
                  >
                    {currentMode === "original" ? "查看批注图" : "查看原图"}
                  </button>
                )}
                {startedAtEpochMs != null && (
                  <button
                    className="ghost"
                    onClick={() => {
                      onSeekVideo?.(scene.observedAtEpochMs);
                    }}
                  >
                    跳转录像
                  </button>
                )}
                {editable && (
                  <button
                    className="item-delete-btn delete"
                    title="从预览和导出中排除"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExclude?.(scene.id);
                    }}
                  >
                    排除
                  </button>
                )}
              </div>
            </div>
            <div className="issue-scene-grid">
              <div className="issue-scene-image-wrap">
                {image ? (
                  <img
                    data-issue-image
                    className="issue-scene-image"
                    src={image}
                    alt="问题现场批注截图"
                  />
                ) : (
                  <div className="issue-scene-image-missing">截图不可用</div>
                )}
              </div>
              <div className="issue-scene-details">
                <div className="scene-grid-row">
                  <div>
                    <span className="scene-label">实际表现</span>
                    <p className="scene-text-actual">
                      {description?.actual || "未填写"}
                    </p>
                  </div>
                  <div>
                    <span className="scene-label">预期表现</span>
                    <p className="scene-text-expected">
                      {description?.expected || "未填写"}
                    </p>
                  </div>
                </div>
                {description?.note && (
                  <div className="scene-note-wrap">
                    <span className="scene-label">补充说明</span>
                    <p className="scene-note-text">{description.note}</p>
                  </div>
                )}
                <div className="scene-flex-column">
                  <div className="scene-flex-space-between">
                    <span className="scene-label">目标元素</span>
                    <span className="issue-scene-target-meta">
                      {scene.target.element.tagName}
                      {scene.target.element.role
                        ? ` · ${scene.target.element.role}`
                        : ""}{" "}
                      ({Math.round(scene.target.element.boundingBox.width)}×
                      {Math.round(scene.target.element.boundingBox.height)}px)
                    </span>
                  </div>

                  {bestLocator && (
                    <div className="locator-bar">
                      <span className="locator-badge">{bestLocator.kind}</span>
                      <code
                        className="locator-code"
                        title={bestLocator.expression}
                      >
                        {bestLocator.expression}
                      </code>
                      <span className="locator-stats">
                        匹配: {bestLocator.matchCount} | 稳定:{" "}
                        {bestLocator.stabilityScore}
                      </span>
                    </div>
                  )}

                  {ancestorItems.length > 0 && (
                    <div className="scene-path-bar">
                      <span className="scene-path-label">路径:</span>{" "}
                      {ancestorItems.map((item, idx) => (
                        <span key={idx}>
                          {idx === ancestorItems.length - 1 ? (
                            <strong className="scene-path-current">
                              {item}
                            </strong>
                          ) : (
                            <span>{item}</span>
                          )}
                          {idx < ancestorItems.length - 1 && (
                            <span className="scene-path-sep"> &gt; </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {vueSnapshotMarkup && (
                    <div
                      dangerouslySetInnerHTML={{ __html: vueSnapshotMarkup }}
                    />
                  )}

                  <pre style={{ marginTop: "4px" }}>{dom}</pre>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </>
  );
});
