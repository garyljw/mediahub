import "server-only";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { env, processEnvironment, systemRoot } from "../env";
import { readInstalledVersion, type System } from "./run";

const SERVICE_NAME = "MediaHub";
/** A silent install takes a minute or two. One that runs this long is stuck, and is killed so rollback can run. */
const INSTALLER_TIMEOUT_MS = 15 * 60 * 1000;

function runTool(file: string, args: string[], environment?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 120_000, env: environment }, (error, stdout) => {
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

/**
 * The real Windows actions, for the paths of one installed app folder and one data folder. The stage 2 command is
 * built only from these two folders, which come from the launcher's own location and env(), never from user input.
 */
export function createWindowsSystem(appDir: string, dataDir: string): System {
  const sc = path.win32.join(systemRoot(), "System32", "sc.exe");
  const taskkill = path.win32.join(systemRoot(), "System32", "taskkill.exe");
  const powershell = path.win32.join(systemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const serviceExe = path.win32.join(appDir, "service", "MediaHub.exe");
  // The copy in the updates folder: stage 2 runs from it, so the app folder can be replaced under it.
  const runNode = path.win32.join(dataDir, "updates", "run", "node.exe");
  const runScript = path.win32.join(dataDir, "updates", "run", "updater.mjs");
  const envFile = path.win32.join(dataDir, "mediahub.env");

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

    async startStage2() {
      for (const value of [runNode, runScript, envFile, appDir, dataDir]) {
        if (value.includes('"')) throw new Error("A MediaHub folder path contains a double quote, so the install step can't start.");
      }
      const cmd = `"${runNode}" --env-file="${envFile}" "${runScript}" --stage2 --app-dir "${appDir}" --data-dir "${dataDir}"`;
      // Win32_Process.Create starts the process from WMI's host, not from this one, so it is outside the service's
      // process tree and survives the service being stopped. The command line goes in through an environment
      // variable, so PowerShell never parses the paths.
      const { code } = await runTool(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:MEDIAHUB_STAGE2_CMD }; exit [int]$r.ReturnValue",
        ],
        { ...processEnvironment(), MEDIAHUB_STAGE2_CMD: cmd },
      );
      if (code !== 0) throw new Error(`Could not start the install step (WMI result ${code}).`);
    },
  };
}
