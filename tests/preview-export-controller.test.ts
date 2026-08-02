import assert from "node:assert/strict";
import test from "node:test";
import { PreviewExportController } from "../src/preview/preview-export-controller.ts";

function createMockDocument() {
  const elements: Record<string, any> = {};

  const createMockElement = (id: string, tagName = "div") => {
    const el = {
      id,
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      disabled: false,
      textContent: "",
      hidden: true,
      style: { width: "" },
      classList: {
        _classes: new Set<string>(),
        add(...cls: string[]) { cls.forEach((c) => this._classes.add(c)); },
        remove(...cls: string[]) { cls.forEach((c) => this._classes.delete(c)); },
        contains(c: string) { return this._classes.has(c); },
      },
      listeners: {} as Record<string, Function[]>,
      addEventListener(type: string, fn: Function) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(fn);
      },
      click() {
        if (this.listeners["click"]) {
          this.listeners["click"].forEach((fn) => fn());
        }
      }
    };
    elements[id] = el;
    return el;
  };

  const button = createMockElement("export", "button");
  const progressBar = createMockElement("export-progress-bar", "div");
  const progressFill = createMockElement("export-progress-fill", "div");

  const doc = {
    querySelector(selector: string) {
      if (selector === "#export") return button;
      if (selector === "#export-progress-bar") return progressBar;
      if (selector === "#export-progress-fill") return progressFill;
      return null;
    }
  };

  return { doc, button, progressBar, progressFill };
}

test("PreviewExportController - 导出进度条成功路径与状态验证", async () => {
  let cleanupCalled = false;
  let revokedUrl: string | undefined;
  let notifiedMessage: string | undefined;
  let artifactChangedCount = 0;
  let exportCompletedCalled = false;

  (globalThis as any).URL = {
    createObjectURL: () => "blob:mock-archive-url",
    revokeObjectURL: (url: string) => { revokedUrl = url; },
  };

  (globalThis as any).chrome = {
    i18n: {
      getMessage: (key: string, subs?: any) => {
        const subStr = Array.isArray(subs) ? subs.join(" ") : String(subs || "");
        return `${key}:${subStr}`;
      }
    },
    downloads: {
      download: async () => 888,
      search: (_query: any, callback: Function) => {
        callback([{ id: 888, state: "complete", filename: "report.zip" }]);
      }
    },
    runtime: { lastError: null }
  };

  const { doc, button, progressBar, progressFill } = createMockDocument();
  const mockSnapshot = {
    session: {
      id: "session-12345678-uuid",
      title: "Test Report",
      quality: { overall: "good", issues: [] },
      target: { initialTitle: "Test", initialUrl: "http://localhost" },
      timeline: { startedAtEpochMs: 1000, durationMs: 5000 },
      options: { privacyMode: "safe" }
    },
    issues: [],
    console: [],
    network: [],
    interactions: [],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0, issueScene: 0 }
  } as any;


  let hundredPercentAsserted = false;

  const controller = new PreviewExportController({
    root: doc as any,
    sessionId: "session-12345678-uuid",
    storage: {
      getExportArtifact: async () => undefined,
      saveExportArtifact: async () => {},
      iterateMediaChunks: async () => {}
    } as any,
    getSnapshot: () => mockSnapshot,
    getMediaChunkCount: () => 10,
    notify: (msg) => { notifiedMessage = msg; },


    onArtifactChanged: () => { artifactChangedCount++; },
    onExportComplete: async () => {
      exportCompletedCalled = true;
      if (progressFill.style.width === "100%" && progressFill.classList.contains("done")) {
        hundredPercentAsserted = true;
      }
      return true;
    },
    loadAssets: async () => ({
      html: '<html lang="zh-CN"><head></head><body></body></html>',
      script: "console.log('report')",
      styles: "body { color: red }",
      icon: new Uint8Array([1, 2, 3])
    } as any),
    createArchive: async () => ({
      sink: {} as any,
      getFile: async () => ({} as any),
      cleanup: async () => { cleanupCalled = true; }
    }),
    writeArchive: async (opts: any) => {
      // 3. 普通文件写入
      opts.onProgress({ mediaChunksWritten: 0, bytesWritten: 2048 });
      assert.equal(progressFill.style.width, "30%");

      // 4. 媒体分片写入 (5/10): 5 + 0.5 * 90 = 50%
      opts.onProgress({ mediaChunksWritten: 5, bytesWritten: 10000 });
      assert.equal(progressFill.style.width, "50%");
      assert.ok(button.textContent.includes("5"));

    }
  });

  // 1. 点击导出前按钮可用
  assert.equal(button.disabled, false);

  const exportPromise = controller.export();

  // 1 & 2. 导出准备阶段：按钮 disabled 为 true，进度条开始显示 (2%)
  assert.equal(button.disabled, true);
  assert.equal(progressBar.hidden, false);
  assert.equal(progressFill.style.width, "2%");

  await exportPromise;

  assert.equal(exportCompletedCalled, true);
  assert.equal(hundredPercentAsserted, true, "导出完成时应进入 100% 进度与 done 状态");

  assert.ok(notifiedMessage?.length);

  // 等待 finally 中的 cleanup 异步执行与 2000ms 自动隐藏延迟
  await new Promise((r) => setTimeout(r, 2200));

  // 7. 延迟结束后隐藏并重置进度条
  assert.equal(progressBar.hidden, true);
  assert.equal(progressFill.style.width, "0%");
  assert.equal(progressFill.classList.contains("done"), false);

  // 8. 最终按钮恢复可用，临时资源被关闭与释放
  assert.equal(button.disabled, false);
  assert.equal(cleanupCalled, true);
  assert.equal(revokedUrl, "blob:mock-archive-url");
});

test("PreviewExportController - 导出进度条失败路径与异常恢复验证", async () => {
  const setupChromeMock = (downloadState: "complete" | "interrupted" = "complete") => {
    (globalThis as any).chrome = {
      i18n: {
        getMessage: (key: string, subs?: any) => {
          const subStr = Array.isArray(subs) ? subs.join(" ") : String(subs || "");
          return `${key}:${subStr}`;
        }
      },
      downloads: {
        download: async () => 999,
        search: (_query: any, callback: Function) => {
          callback([{ id: 999, state: downloadState, error: downloadState === "interrupted" ? "SERVER_BAD_CONTENT" : undefined }]);
        }
      },
      runtime: { lastError: null }
    };
  };

  const defaultMockSnapshot = {
    session: {
      id: "sess-err",
      title: "Err Report",
      quality: { overall: "good", issues: [] },
      target: { initialTitle: "Test", initialUrl: "http://localhost" },
      timeline: { startedAtEpochMs: 1000, durationMs: 5000 },
      options: { privacyMode: "safe" }
    },
    issues: [],
    console: [],
    network: [],
    interactions: [],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0, issueScene: 0 }
  } as any;


  const defaultAssetsMock = async () => ({
    html: '<html lang="zh-CN"><head></head><body></body></html>',
    script: "console.log('report')",
    styles: "body { color: red }",
    icon: new Uint8Array([1, 2, 3])
  } as any);

  // 1. 创建归档失败
  {
    setupChromeMock();
    const { doc, button, progressFill } = createMockDocument();
    let notified = "";

    const controller = new PreviewExportController({
      root: doc as any,
      sessionId: "session-err",
      storage: { getExportArtifact: async () => undefined, saveExportArtifact: async () => {} } as any,
      getSnapshot: () => defaultMockSnapshot,
      getMediaChunkCount: () => 0,
      notify: (msg) => { notified = msg; },
      onArtifactChanged: () => {},
      loadAssets: defaultAssetsMock,
      createArchive: async () => { throw new Error("Disk full"); }
    });

    await controller.export();

    assert.equal(progressFill.style.width, "2%");
    assert.equal(button.disabled, false);
    assert.ok(notified.length > 0);
  }

  // 2. 写入归档失败
  {
    setupChromeMock();
    const { doc, button } = createMockDocument();
    let cleanupCalled = false;
    let notified = "";

    const controller = new PreviewExportController({
      root: doc as any,
      sessionId: "session-err-2",
      storage: { getExportArtifact: async () => undefined, saveExportArtifact: async () => {} } as any,
      getSnapshot: () => defaultMockSnapshot,
      getMediaChunkCount: () => 0,
      notify: (msg) => { notified = msg; },
      onArtifactChanged: () => {},
      loadAssets: defaultAssetsMock,
      createArchive: async () => ({
        sink: {} as any,
        getFile: async () => ({} as any),
        cleanup: async () => { cleanupCalled = true; }
      }),
      writeArchive: async () => { throw new Error("Write failed"); }
    });

    await controller.export();

    assert.equal(button.disabled, false);
    assert.equal(cleanupCalled, true);
    assert.ok(notified.length > 0);
  }

  // 3. 下载被中断
  {
    setupChromeMock("interrupted");
    const { doc, button, progressFill } = createMockDocument();
    let notified = "";

    (globalThis as any).URL = {
      createObjectURL: () => "blob:interrupted-url",
      revokeObjectURL: () => {},
    };

    const controller = new PreviewExportController({
      root: doc as any,
      sessionId: "session-interrupted",
      storage: { getExportArtifact: async () => undefined, saveExportArtifact: async () => {} } as any,
      getSnapshot: () => defaultMockSnapshot,
      getMediaChunkCount: () => 0,
      notify: (msg) => { notified = msg; },
      onArtifactChanged: () => {},
      loadAssets: defaultAssetsMock,
      createArchive: async () => ({
        sink: {} as any,
        getFile: async () => ({} as any),
        cleanup: async () => {}
      }),
      writeArchive: async () => {}
    });

    await controller.export();

    assert.equal(progressFill.classList.contains("done"), false);
    assert.ok(notified.length > 0);
    assert.equal(button.disabled, false);
  }

  // 4. 用户取消下载 (USER_CANCELED)
  {
    (globalThis as any).chrome = {
      i18n: {
        getMessage: (key: string, subs?: any) => {
          const subStr = subs ? (Array.isArray(subs) ? subs.join(" ") : String(subs)) : "";
          return `${key}:${subStr}`;
        }
      },
      downloads: {
        download: async () => 777,
        search: (_query: any, callback: Function) => {
          callback([{ id: 777, state: "interrupted", error: "USER_CANCELED" }]);
        }
      },
      runtime: { lastError: null }
    };

    const { doc, button, progressFill } = createMockDocument();
    let notified = "";

    const controller = new PreviewExportController({
      root: doc as any,
      sessionId: "session-canceled",
      storage: { getExportArtifact: async () => undefined, saveExportArtifact: async () => {} } as any,
      getSnapshot: () => defaultMockSnapshot,
      getMediaChunkCount: () => 0,
      notify: (msg) => { notified = msg; },
      onArtifactChanged: () => {},
      loadAssets: defaultAssetsMock,
      createArchive: async () => ({
        sink: {} as any,
        getFile: async () => ({} as any),
        cleanup: async () => {}
      }),
      writeArchive: async () => {}
    });

    await controller.export();

    assert.equal(progressFill.classList.contains("done"), false);
    assert.equal(notified, "exportCanceled:");
    assert.equal(button.disabled, false);
  }
});
