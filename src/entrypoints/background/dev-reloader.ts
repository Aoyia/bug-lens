declare const process: { env: { NODE_ENV: string } };

export function initDevReloader() {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const WS_URL = "ws://localhost:8899";
  let socket: WebSocket | null = null;

  function connect() {
    try {
      socket = new WebSocket(WS_URL);

      socket.onmessage = (event) => {
        if (event.data === "reload") {
          console.log(
            "[DevReloader] Received reload signal, reloading extension..."
          );
          chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
              if (
                tab.id &&
                tab.url &&
                tab.url.startsWith(chrome.runtime.getURL(""))
              ) {
                chrome.tabs.reload(tab.id);
              }
            }
            chrome.runtime.reload();
          });
        }
      };

      socket.onclose = () => {
        setTimeout(connect, 2000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    } catch {
      setTimeout(connect, 2000);
    }
  }

  connect();
}
