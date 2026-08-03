import type { InteractionCapture } from "./interaction-capture";
import type { EvidenceRepository } from "../storage/db";
import type { InteractionRecord } from "../shared/protocol";

type NavigationRepository = Pick<EvidenceRepository, "getActiveSession">;

export class NavigationCapture {
  private attached = false;
  private readonly listener: (
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
  ) => void;
  private readonly repository: NavigationRepository;
  private readonly interactionCapture: InteractionCapture;

  constructor(
    repository: NavigationRepository,
    interactionCapture: InteractionCapture
  ) {
    this.repository = repository;
    this.interactionCapture = interactionCapture;
    this.listener = this.onNavigationCommitted.bind(this);
  }

  attach(): void {
    if (this.attached || !chrome.webNavigation?.onCommitted) return;
    this.attached = true;
    chrome.webNavigation.onCommitted.addListener(this.listener);
  }

  detach(): void {
    if (!this.attached || !chrome.webNavigation?.onCommitted) return;
    this.attached = false;
    chrome.webNavigation.onCommitted.removeListener(this.listener);
  }

  private async onNavigationCommitted(
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
  ): Promise<void> {
    if (details.frameId !== 0) return; // Only capture main frame navigation
    const session = await this.repository.getActiveSession();
    if (!session || session.target.tabId !== details.tabId) return;
    if (session.status !== "RECORDING" && session.status !== "DEGRADED") return;

    const record: InteractionRecord = {
      id: crypto.randomUUID(),
      sessionId: session.nonce,
      kind: "navigation",
      status: "confirmed",
      createdAt: Date.now(),
      confirmedAt: Date.now(),
      page: {
        url: details.url,
        title: "",
        frameId: 0,
      },
      input: { pointerType: "navigation", button: 0, isTrusted: true },
      coordinates: {
        clientX: 0,
        clientY: 0,
        pageX: 0,
        pageY: 0,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 1,
        viewport: { width: 0, height: 0 },
      },
      element: {
        tagName: "document",
        classNames: [],
        attributes: {},
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        locators: [
          {
            kind: "css",
            expression: "document",
            matchCount: 1,
            stabilityScore: 1.0,
            reasons: ["Document Navigation"],
          },
        ],
      },
      metadata: {
        navigationType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
        toUrl: details.url,
      },
      screenshot: { status: "unavailable" },
    };

    const sender: chrome.runtime.MessageSender = {
      tab: { id: details.tabId } as chrome.tabs.Tab,
    };

    await this.interactionCapture.handle(record, sender);
  }
}
