import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
const execAsync = promisify(exec);
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function activate(context: vscode.ExtensionContext) {
  const quotaProvider = new QuotaProvider();
  vscode.window.registerTreeDataProvider("quota-view", quotaProvider);
  context.subscriptions.push(
    vscode.commands.registerCommand("quota-view.refreshEntry", () => quotaProvider.manualRefresh()),
  );
}

class QuotaProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private nextFetchTime = Date.now() + REFRESH_INTERVAL_MS;
  private cachedModels: any[] = [];
  private isFetching = false;
  private hasFetchedOnce = false;
  private lastError = "";

  constructor() {
    setInterval(() => {
      if (Date.now() >= this.nextFetchTime && !this.isFetching) {
        this.refresh();
      }
      this._onDidChangeTreeData.fire();
    }, 1000);
  }

  async manualRefresh() {
    await this.refresh();
  }

  async refresh() {
    if (this.isFetching) return;
    this.isFetching = true;
    this.lastError = "";
    try {
      this.cachedModels = await this.fetchQuotas();
    } catch (e: any) {
      this.lastError = e?.message || String(e);
      console.error("Quota fetch error:", e);
    } finally {
      this.isFetching = false;
      this.hasFetchedOnce = true;
      this.nextFetchTime = Date.now() + REFRESH_INTERVAL_MS;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return [];

    // Only auto-fetch once on first load, not every time models are empty
    if (!this.hasFetchedOnce && !this.isFetching) {
      await this.refresh();
    }

    const secondsLeft = Math.max(0, Math.floor((this.nextFetchTime - Date.now()) / 1000));
    const timerItem = new vscode.TreeItem(
      `Next check in: ${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, "0")}`,
    );
    timerItem.iconPath = new vscode.ThemeIcon("watch");

    if (this.isFetching) {
      const loadingItem = new vscode.TreeItem("Fetching quotas…");
      loadingItem.iconPath = new vscode.ThemeIcon("sync~spin");
      return [timerItem, loadingItem];
    }

    if (this.cachedModels.length === 0) {
      const msg = this.lastError ? `Error: ${this.lastError}` : "No models found";
      const noData = new vscode.TreeItem(msg);
      noData.iconPath = new vscode.ThemeIcon(this.lastError ? "error" : "info");
      noData.tooltip = "Click the refresh button to retry.";
      return [timerItem, noData];
    }

    const modelItems = this.cachedModels.map((m) => {
      const perc = Math.round((m.quotaInfo?.remainingFraction ?? 1) * 100);
      const item = new vscode.TreeItem(m.label);
      const resetStr = this.formatResetTime(m.quotaInfo?.resetTime);
      item.description = resetStr ? `${perc}% · ↻ ${resetStr}` : `${perc}% remaining`;
      const filled = Math.round(perc / 10);
      item.tooltip = `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${perc}%\nResets: ${m.quotaInfo?.resetTime || "N/A"}`;
      item.iconPath = new vscode.ThemeIcon(
        perc > 50 ? "check" : perc > 20 ? "warning" : "error",
        new vscode.ThemeColor(perc > 50 ? "charts.green" : perc > 20 ? "charts.yellow" : "charts.red"),
      );
      return item;
    });
    return [timerItem, ...modelItems];
  }

  private formatResetTime(resetTime: string | undefined): string {
    if (!resetTime) return "";
    const resetMs = new Date(resetTime).getTime();
    if (isNaN(resetMs)) return "";
    const diffMs = resetMs - Date.now();
    if (diffMs <= 0) return "soon";
    const totalMin = Math.floor(diffMs / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(" ");
  }

  private async fetchQuotas(): Promise<any[]> {
    const isWindows = os.platform() === "win32";

    const { csrf, ports } = isWindows ? await this.discoverWindows() : await this.discoverUnix();

    if (ports.length === 0) return [];

    for (const port of ports) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`, {
          method: "POST",
          headers: {
            "X-Codeium-Csrf-Token": csrf,
            "Connect-Protocol-Version": "1",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ metadata: { ideName: "antigravity", extensionName: "antigravity", locale: "en" } }),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          return data.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
        }
      } catch {}
    }
    return [];
  }

  private async discoverWindows(): Promise<{ csrf: string; ports: string[] }> {
    // Use WMIC to find language_server process with its command line
    const { stdout: wmicOut } = await execAsync(
      "wmic process where \"commandline like '%language_server%'\" get ProcessId,CommandLine /format:list",
      { maxBuffer: 4 * 1024 * 1024 },
    );

    // Parse WMIC list output — blocks separated by blank lines
    const blocks = wmicOut.split(/\r?\n\r?\n/).filter((b) => b.trim());
    let csrf = "";
    let pid = "";

    for (const block of blocks) {
      const cmdMatch = block.match(/CommandLine=(.+)/i);
      const pidMatch = block.match(/ProcessId=(\d+)/i);
      if (!cmdMatch || !pidMatch) continue;

      const cmdLine = cmdMatch[1].trim();
      if (!cmdLine.includes("language_server") || cmdLine.includes("wmic")) continue;

      csrf = (cmdLine.match(/--csrf_token[\s=]+([^\s"]+)/) || [])?.[1] || "";
      pid = pidMatch[1].trim();
      break;
    }

    if (!pid) return { csrf: "", ports: [] };

    // Use netstat to find listening ports for the PID
    const { stdout: netstatOut } = await execAsync(`netstat -ano | findstr ${pid} | findstr LISTENING`);
    const portMatches = netstatOut.match(/:(\d+)\s+[\d.]+:\d+\s+LISTENING/g) || [];
    const ports = [...new Set(portMatches.map((p) => p.match(/:(\d+)/)![1]))];

    return { csrf, ports };
  }

  private async discoverUnix(): Promise<{ csrf: string; ports: string[] }> {
    const { stdout: psOut } = await execAsync("ps aux | grep language_server | grep -v grep");
    const line = psOut.split("\n")[0];
    const pid = line.trim().split(/\s+/)[1];
    const csrf = (line.match(/--csrf_token\s+([^\s]+)/) || line.match(/--csrf_token=([^\s]+)/))?.[1] || "";
    const { stdout: lsofOut } = await execAsync(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN`);
    const ports = [...new Set(lsofOut.match(/:(\d+)\s+\(LISTEN\)/g)?.map((p) => p.match(/:(\d+)/)![1]))];
    return { csrf, ports: ports as string[] };
  }
}
