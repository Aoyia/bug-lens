import type { ConsoleEntry, NetworkEntry, RecordingSession } from "../shared/protocol";
import { ConsoleView } from "./console-view";
import { NetworkView } from "./network-view";

export type DiagnosticsSnapshot = {
  session?: RecordingSession;
  consoleEntries: ConsoleEntry[];
  includedConsoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  includedNetworkEntries: NetworkEntry[];
};

export type DiagnosticsActions = {
  getSnapshot(): DiagnosticsSnapshot;
  exclude?(kind: "console" | "network", id: string): Promise<void>;
  restore?(kind: "console" | "network"): Promise<void>;
  selectionChanged?(): void;
  notify(message: string): void;
};

export class DiagnosticsView {
  private readonly consoleView: ConsoleView;
  private readonly networkView: NetworkView;

  constructor(private readonly actions: DiagnosticsActions, root: Document) {
    const render = () => this.render();
    const selectionChanged = () => {
      actions.selectionChanged?.();
      render();
    };
    this.consoleView = new ConsoleView(root, {
      exclude: actions.exclude ? (id) => actions.exclude!("console", id) : undefined,
      restore: actions.restore ? () => actions.restore!("console") : undefined,
      render,
      selectionChanged,
      notify: actions.notify
    });
    this.networkView = new NetworkView(root, {
      exclude: actions.exclude ? (id) => actions.exclude!("network", id) : undefined,
      restore: actions.restore ? () => actions.restore!("network") : undefined,
      render,
      selectionChanged,
      notify: actions.notify
    });
  }

  render(): void {
    const snapshot = this.actions.getSnapshot();
    this.consoleView.render({
      session: snapshot.session,
      all: snapshot.consoleEntries,
      included: snapshot.includedConsoleEntries
    });
    this.networkView.render({
      session: snapshot.session,
      all: snapshot.networkEntries,
      included: snapshot.includedNetworkEntries
    });
  }
}
