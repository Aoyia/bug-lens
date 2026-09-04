const ElementBase =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {
        attachShadow() {
          return { appendChild() {} };
        }
      } as unknown as typeof HTMLElement);

export class TruncatedText extends ElementBase {
  static get observedAttributes(): string[] {
    return ["text", "title", "no-tooltip"];
  }

  private spanEl: HTMLSpanElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: inline-block;
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        vertical-align: middle;
      }
      span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    this.spanEl = document.createElement("span");
    shadow.appendChild(style);
    shadow.appendChild(this.spanEl);
  }

  connectedCallback(): void {
    if (
      !this.hasAttribute("text") &&
      !this.spanEl.textContent &&
      this.childNodes.length > 0
    ) {
      const text = Array.from(this.childNodes)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (text) {
        this.spanEl.textContent = text;
      }
    }
    this.render();
    if (typeof this.addEventListener === "function") {
      this.addEventListener("mouseenter", this.handleMouseEnter);
    }
  }

  disconnectedCallback(): void {
    if (typeof this.removeEventListener === "function") {
      this.removeEventListener("mouseenter", this.handleMouseEnter);
    }
  }

  private handleMouseEnter = (): void => {
    this.updateOverflowState();
  };

  checkOverflow(): boolean {
    if (!this.spanEl) return false;
    // 文本实际宽度超过宿主容器宽度即视为截断
    const spanWidth = this.spanEl.scrollWidth || 0;
    const hostWidth = this.clientWidth || 0;
    return spanWidth > hostWidth || (this.scrollWidth || 0) > hostWidth;
  }

  updateOverflowState(): boolean {
    const isOverflow = this.checkOverflow();
    if (typeof this.toggleAttribute === "function") {
      this.toggleAttribute("data-overflowed", isOverflow);
    }

    if (!this.hasAttribute("no-tooltip")) {
      const customTitle = this.getAttribute("title");
      if (isOverflow) {
        if (customTitle !== null) {
          this.spanEl.title = customTitle;
        } else if (this.spanEl.textContent) {
          this.spanEl.title = this.spanEl.textContent;
        }
      } else {
        this.spanEl.removeAttribute("title");
      }
    }
    return isOverflow;
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    if (oldValue === newValue) return;
    if (name === "text") {
      this.spanEl.textContent = newValue ?? "";
    }
    if (name === "text" || name === "title" || name === "no-tooltip") {
      this.render();
    }
  }

  private render(): void {
    if (this.hasAttribute("text")) {
      const text = this.getAttribute("text") ?? "";
      if (this.spanEl.textContent !== text) {
        this.spanEl.textContent = text;
      }
    }

    if (this.hasAttribute("no-tooltip")) {
      this.spanEl.removeAttribute("title");
      if (this.hasAttribute("title")) {
        this.removeAttribute("title");
      }
      return;
    }

    this.updateOverflowState();
  }

  set textContent(value: string | null) {
    const text = value ?? "";
    if (typeof this.hasAttribute === "function" && this.hasAttribute("text")) {
      this.setAttribute("text", text);
    } else if (this.spanEl) {
      this.spanEl.textContent = text;
      this.render();
    }
  }

  get textContent(): string {
    return this.spanEl?.textContent ?? "";
  }

  set innerText(value: string | null) {
    this.textContent = value;
  }

  get innerText(): string {
    return this.textContent;
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("truncated-text")
) {
  customElements.define("truncated-text", TruncatedText);
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "truncated-text": {
        id?: string;
        class?: string;
        className?: string;
        text?: string;
        title?: string;
        "no-tooltip"?: boolean;
        children?: unknown;
        style?: unknown;
      };
    }
  }
}

declare module "preact" {
  namespace JSX {
    interface IntrinsicElements {
      "truncated-text": {
        id?: string;
        class?: string;
        className?: string;
        text?: string;
        title?: string;
        "no-tooltip"?: boolean;
        children?: unknown;
        style?: unknown;
      };
    }
  }
}
