const { spawn } = require("node:child_process");

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const children = [];
let shuttingDown = false;

function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

function startServices() {
  for (const file of ["export/server/index.js", "web/server.js"]) {
    const child = spawn(process.execPath, [file], { stdio: "inherit" });
    children.push(child);
    child.on("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error("\n" + file + " stopped" + (signal ? " (" + signal + ")" : "") + ".");
        stop(code ?? 1);
      }
    });
  }
}

const compiler = spawn(command, ["tsc"], { stdio: "inherit" });
compiler.on("exit", (code) => {
  if (code === 0) startServices();
  else process.exitCode = code ?? 1;
});

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
