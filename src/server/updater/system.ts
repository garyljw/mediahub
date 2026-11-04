import "server-only";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { env, systemRoot } from "../env";
import { readInstalledVersion, type System } from "./run";

const SERVICE_NAME = "MediaHub";
const TASKS = [
  { name: "MediaHub\\Updater", template: "MediaHub-Updater.xml" },
  { name: "MediaHub\\UpdateInstall", template: "MediaHub-UpdateInstall.xml" },
];
const INSTALL_TASK = "MediaHub\\UpdateInstall";
/** A silent install takes a minute or two. One that runs this long is stuck, and is killed so rollback can run. */
const INSTALLER_TIMEOUT_MS = 15 * 60 * 1000;

function runTool(file: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 120_000 }, (error, stdout) => {
      let code = 0;
      if (error) {
        const exitCode = (error as { code?: unknown }).code;
        code = typeof exitCode === "number" ? exitCode : -1;
      }
      resolve({ code, stdout: String(stdout) });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Host to poll for the health check. The wildcard addresses are reached through the loopback address. */
function healthHost(): string {
  const host = env().MEDIAHUB_HOST;
  return host === "" || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

async function loginAnswers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

/** The real Windows actions, for the paths of one installed app folder. */
export function createWindowsSystem(appDir: string): System {
  const sc = path.win32.join(systemRoot(), "System32", "sc.exe");
  const schtasks = path.win32.join(systemRoot(), "System32", "schtasks.exe");
  const taskkill = path.win32.join(systemRoot(), "System32", "taskkill.exe");
  const serviceExe = path.win32.join(appDir, "service", "MediaHub.exe");

  return {
    async stopService() {
      // WinSW's stopwait returns once the service has stopped. The state is checked anyway.
      await runTool(serviceExe, ["stopwait"]);
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const { code, stdout } = await runTool(sc, ["query", SERVICE_NAME]);
        if (code === 0 && /STATE\s+:\s+1\s+STOPPED/.test(stdout)) return;
        await sleep(1_000);
      }
      throw new Error("The MediaHub service did not stop within 60 seconds.");
    },

    async startService() {
      const { code } = await runTool(sc, ["start", SERVICE_NAME]);
      if (code !== 0) throw new Error(`sc start exited with ${code}.`);
    },

    runInstaller(exe: string, logFile: string) {
      return new Promise<number>((resolve, reject) => {
        const child = spawn(
          exe,
          ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/UPDATER", `/LOG=${logFile}`],
          { windowsHide: true, stdio: "ignore" },
        );
        // The whole process tree, in case Setup started a child that does the work.
        const timer = setTimeout(() => {
          if (child.pid === undefined) return;
          execFile(taskkill, ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true }, () => {});
        }, INSTALLER_TIMEOUT_MS);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve(code ?? -1);
        });
      });
    },

    async waitHealthy(expectVersion: string, timeoutMs: number) {
      const url = `http://${healthHost()}:${env().MEDIAHUB_PORT}/login`;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        let versionMatches = false;
        try {
          versionMatches = readInstalledVersion(appDir) === expectVersion;
        } catch {
          versionMatches = false;
        }
        if (versionMatches && (await loginAnswers(url))) return true;
        await sleep(2_000);
      }
      return false;
    },

    async registerTask() {
      // Stage 2 runs in the install task, which comes last: re-registering the task this process runs in may
      // stop it (see mediahub.iss).
      // Both are attempted even if the first fails, so one failure doesn't leave the other on an old definition.
      const failures: string[] = [];
      for (const task of TASKS) {
        const xml = path.win32.join(appDir, "service", task.template);
        const { code } = await runTool(schtasks, ["/create", "/tn", task.name, "/xml", xml, "/f"]);
        if (code !== 0) failures.push(`${task.name} (exit code ${code})`);
      }
      if (failures.length > 0) throw new Error(`schtasks /create failed for ${failures.join(", ")}.`);
    },

    async startInstallTask() {
      const { code } = await runTool(schtasks, ["/run", "/tn", INSTALL_TASK]);
      if (code !== 0) throw new Error(`schtasks /run exited with ${code}.`);
    },
  };
}
