import type { RecordingSession } from "../src/shared/protocol.ts";

/**
 * 最小 chrome mock：覆盖 background runtime 测试所需的 chrome API 面。
 * 通过 handlers 对象在测试内按需覆写。
 */
export type ChromeMock = {
  runtime: {
    getManifest: () => { version: string };
    getURL: (path: string) => string;
    sendMessage: (message: unknown) => Promise<unknown>;
    lastError?: Error;
    getContexts: () => Promise<unknown[]>;
    onMessage: { addListener: () => void };
  };
  tabs: {
    get: (tabId: number) => Promise<unknown>;
    query: (queryInfo: unknown) => Promise<unknown[]>;
    create: (createProperties: unknown) => Promise<unknown>;
    captureVisibleTab: (windowId: number, options: unknown) => Promise<string>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  };
  tabCapture: {
    getMediaStreamId: (
      options: unknown,
      callback: (streamId?: string) => void
    ) => void;
  };
  downloads: {
    download: (options: unknown) => Promise<number>;
    search: (query: unknown, callback: (items: unknown[]) => void) => void;
  };
  scripting: {
    executeScript: (details: unknown) => Promise<unknown[]>;
  };
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (value: Record<string, unknown>) => Promise<void>;
    };
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
    };
  };
  debugger: {
    onEvent: { addListener: () => void };
    onDetach: { addListener: () => void };
  };
  alarms: {
    create: () => void;
    onAlarm: { addListener: () => void };
  };
  commands: {
    onCommand: { addListener: () => void };
  };
  offscreen: {
    createDocument: () => Promise<void>;
  };
  action: {
    setBadgeText: () => Promise<void>;
    setBadgeBackgroundColor: () => Promise<void>;
    setIcon: () => Promise<void>;
  };
};

export type ChromeHandlers = {
  getManifest?: () => { version: string };
  getURL?: (path: string) => string;
  sendMessage?: (message: unknown) => Promise<unknown>;
  getContexts?: () => Promise<unknown[]>;
  tabsGet?: (tabId: number) => Promise<unknown>;
  tabsQuery?: (queryInfo: unknown) => Promise<unknown[]>;
  tabsCreate?: (createProperties: unknown) => Promise<unknown>;
  captureVisibleTab?: (windowId: number) => Promise<string>;
  tabsSendMessage?: (tabId: number, message: unknown) => Promise<unknown>;
  getMediaStreamId?: (
    options: unknown,
    callback: (streamId?: string) => void
  ) => void;
  downloadsDownload?: (options: unknown) => Promise<number>;
  downloadsSearch?: (
    query: unknown,
    callback: (items: unknown[]) => void
  ) => void;
  executeScript?: (details: unknown) => Promise<unknown[]>;
  storageSessionGet?: (key: string) => Promise<Record<string, unknown>>;
  storageSessionSet?: (value: Record<string, unknown>) => Promise<void>;
  storageLocalGet?: (key: string) => Promise<Record<string, unknown>>;
};

/** 安装 chrome mock 到 globalThis；返回可覆写 handlers 与当前 mock 引用。 */
export function installChromeMock(handlers: ChromeHandlers = {}): {
  chrome: ChromeMock;
  handlers: ChromeHandlers;
} {
  const h: ChromeHandlers = {
    getManifest: () => ({ version: "0.6.0" }),
    getURL: (path: string) => `chrome-extension://test/${path}`,
    sendMessage: async () => ({ ok: true }),
    getContexts: async () => [],
    tabsGet: async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: "https://example.com/",
      title: "Example",
    }),
    tabsQuery: async () => [
      { id: 42, windowId: 1, url: "https://example.com/", title: "Example" },
    ],
    tabsCreate: async () => ({ id: 99 }),
    captureVisibleTab: async () => "data:image/png;base64,AAA",
    tabsSendMessage: async () => ({}),
    getMediaStreamId: (_options, callback) => callback("stream-1"),
    downloadsDownload: async () => 7,
    downloadsSearch: (_query, callback) =>
      callback([{ id: 7, filename: "/tmp/evidence.zip", state: "complete" }]),
    executeScript: async () => [],
    storageSessionGet: async () => ({}),
    storageSessionSet: async () => {},
    storageLocalGet: async () => ({}),
    ...handlers,
  };

  const chrome: ChromeMock = {
    runtime: {
      getManifest: () => h.getManifest!(),
      getURL: (path: string) => h.getURL!(path),
      sendMessage: (message: unknown) => h.sendMessage!(message),
      getContexts: () => h.getContexts!(),
      onMessage: { addListener: () => {} },
    },
    tabs: {
      get: (tabId: number) => h.tabsGet!(tabId),
      query: (queryInfo: unknown) => h.tabsQuery!(queryInfo),
      create: (createProperties: unknown) => h.tabsCreate!(createProperties),
      captureVisibleTab: (windowId: number, _options: unknown) =>
        h.captureVisibleTab!(windowId),
      sendMessage: (tabId: number, message: unknown) =>
        h.tabsSendMessage!(tabId, message),
    },
    tabCapture: {
      getMediaStreamId: (options: unknown, callback: (id?: string) => void) =>
        h.getMediaStreamId!(options, callback),
    },
    downloads: {
      download: (options: unknown) => h.downloadsDownload!(options),
      search: (query: unknown, callback: (items: unknown[]) => void) =>
        h.downloadsSearch!(query, callback),
    },
    scripting: {
      executeScript: (details: unknown) => h.executeScript!(details),
    },
    storage: {
      session: {
        get: (key: string) => h.storageSessionGet!(key),
        set: (value: Record<string, unknown>) => h.storageSessionSet!(value),
      },
      local: {
        get: (key: string) => h.storageLocalGet!(key),
      },
    },
    debugger: {
      onEvent: { addListener: () => {} },
      onDetach: { addListener: () => {} },
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: () => {} },
    },
    commands: {
      onCommand: { addListener: () => {} },
    },
    offscreen: {
      createDocument: async () => {},
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setIcon: async () => {},
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = chrome;
  return { chrome, handlers: h };
}

/** 断言消息枚举：验证 envelope 形状。 */
export function expectOk(result: unknown): asserts result is { ok: true } {
  assertShape(result);
  if (!(result as { ok?: boolean }).ok)
    throw new Error(`预期 ok:true，实际 ${JSON.stringify(result)}`);
}

function assertShape(value: unknown): void {
  if (!value || typeof value !== "object")
    throw new Error(`预期对象，实际 ${String(value)}`);
}

export type { RecordingSession };
