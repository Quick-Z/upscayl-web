const { spawn } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

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
    const child = spawn(process.execPath, [path.join(projectRoot, file)], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    children.push(child);
    child.once("error", (error) => {
      console.error(`Failed to start ${file}:`, error.message);
      stop(1);
    });
    child.on("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error("\n" + file + " stopped" + (signal ? " (" + signal + ")" : "") + ".");
        stop(code ?? 1);
      }
    });
  }
}

// Execute TypeScript through Node directly. This avoids spawning npx.cmd on
// Windows, where .cmd shims require a shell and can fail with EINVAL.
const tscPath = require.resolve("typescript/bin/tsc");
const compiler = spawn(process.execPath, [tscPath], {
  cwd: projectRoot,
  stdio: "inherit",
});
compiler.once("error", (error) => {
  console.error("Failed to start TypeScript compiler:", error.message);
  process.exitCode = 1;
});
compiler.on("exit", (code) => {
  if (code === 0) startServices();
  else process.exitCode = code ?? 1;
});

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
