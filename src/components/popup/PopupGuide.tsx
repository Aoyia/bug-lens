import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../../shared/i18n.ts";

type GuideStep = {
  selector: string;
  title: string;
  desc: string;
  align?: "bottom" | "top";
};

const STEPS: GuideStep[] = [
  {
    selector: "#start",
    title: "guidePopupStep1Title",
    desc: "guidePopupStep1Desc",
    align: "bottom",
  },
  {
    selector: "#evidence",
    title: "guidePopupStep2Title",
    desc: "guidePopupStep2Desc",
    align: "bottom",
  },
];

type Spotlight = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/**
 * Popup 内嵌的首次使用引导：在扩展弹窗打开时展示（不再于网页录制过程中弹出）。
 * 用高亮框 + 气泡分步指向 Popup 内的核心元素，完成或跳过即写入
 * chrome.storage.local 的 hasCompletedGuide 标记，避免重复出现。
 */
export function PopupGuide({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [spot, setSpot] = useState<Spotlight | null>(null);
  const [bubbleBelow, setBubbleBelow] = useState(true);
  const tickRef = useRef<number | undefined>(undefined);

  const step = STEPS[stepIndex];

  const applySpot = (el: HTMLElement, current: GuideStep) => {
    const r = el.getBoundingClientRect();
    const pad = 4;
    setSpot({
      top: Math.max(0, r.top - pad),
      left: Math.max(0, r.left - pad),
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    });
    // 目标下方空间不足时气泡放到上方
    setBubbleBelow(
      current.align !== "top" && r.bottom + 150 <= window.innerHeight
    );
  };

  useEffect(() => {
    if (!visible) return;
    setStepIndex(0);
    const position = () => {
      const el = document.querySelector<HTMLElement>(STEPS[0].selector);
      if (el) applySpot(el, STEPS[0]);
    };
    position();
    tickRef.current = window.setInterval(position, 400);
    return () => {
      if (tickRef.current !== undefined) {
        window.clearInterval(tickRef.current);
        tickRef.current = undefined;
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !step) return;
    const el = document.querySelector<HTMLElement>(step.selector);
    if (el) applySpot(el, step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, visible]);

  if (!visible || !step) return null;

  const next = () => {
    if (stepIndex < STEPS.length - 1) setStepIndex(stepIndex + 1);
    else onDone();
  };

  const isLast = stepIndex === STEPS.length - 1;

  return (
    <div className="popup-guide" data-testid="popup-guide" role="dialog">
      <div className="popup-guide-mask" />
      {spot && (
        <div
          className="popup-guide-spot"
          style={{
            top: `${spot.top}px`,
            left: `${spot.left}px`,
            width: `${spot.width}px`,
            height: `${spot.height}px`,
          }}
        />
      )}
      <div
        className={`popup-guide-bubble ${bubbleBelow ? "below" : "above"}`}
        style={{
          top: spot
            ? `${bubbleBelow ? spot.top + spot.height + 10 : Math.max(8, spot.top - 150)}px`
            : "50%",
        }}
      >
        <div className="popup-guide-bubble-head">
          <span className="popup-guide-title">{t(step.title)}</span>
          <span className="popup-guide-step">
            {stepIndex + 1}/{STEPS.length}
          </span>
        </div>
        <div className="popup-guide-body">{t(step.desc)}</div>
        <div className="popup-guide-actions">
          <button className="popup-guide-skip" onClick={onDone}>
            {t("guideSkip")}
          </button>
          <button className="popup-guide-next" onClick={next}>
            {isLast ? t("guideGotIt") : t("guideNext")}
          </button>
        </div>
      </div>
    </div>
  );
}
