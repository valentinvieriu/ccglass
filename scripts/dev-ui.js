import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const dashboardPort = portIndex >= 0 ? args[portIndex + 1] : process.env.CCGLASS_DASHBOARD_PORT;
const children = [
  spawn(process.execPath, ["--watch", "scripts/dev.js", ...args], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...(dashboardPort ? { CCGLASS_DASHBOARD_PORT: dashboardPort } : {}) },
  }),
];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of children) {
  child.on("error", (error) => {
    process.stderr.write(`ccglass dev: ${error.message}\n`);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
