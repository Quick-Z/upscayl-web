import { createServer, IncomingMessage, ServerResponse } from "http";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { MODELS } from "../common/models-list";
import { getSystemResources } from "./system-resources";

const host = process.env.API_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.API_PORT || "3000", 10);
const maxBodyBytes = 50 * 1024 * 1024;
const requestTimeoutMs = 10 * 60 * 1000;
let activeJob = false;

type OutputFormat = "png" | "jpg" | "webp";

const projectRoot = resolve(__dirname, "../..");

function getPlatformPaths() {
  if (process.platform === "darwin") {
    return {
      executable: join(projectRoot, "resources", "mac", "bin", "upscayl-bin"),
      models: join(projectRoot, "resources", "models"),
    };
  }
  if (process.platform === "linux") {
    return {
      executable: join(projectRoot, "resources", "linux", "bin", "upscayl-bin"),
      models: join(projectRoot, "resources", "models"),
    };
  }
  if (process.platform === "win32") {
    return {
      executable: join(projectRoot, "resources", "win", "bin", "upscayl-bin.exe"),
      models: join(projectRoot, "resources", "models"),
    };
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  response.end(body);
}

function contentType(format: OutputFormat) {
  return format === "jpg" ? "image/jpeg" : `image/${format}`;
}

function parseFormat(value: string | null): OutputFormat {
  const format = (value || "png").toLowerCase().replace("jpeg", "jpg");
  if (format !== "png" && format !== "jpg" && format !== "webp") {
    throw new Error("format must be png, jpg, or webp");
  }
  return format;
}

function parseScale(value: string | null) {
  const scale = value || "4";
  if (!/^[234]$/.test(scale)) {
    throw new Error("scale must be 2, 3, or 4");
  }
  return scale;
}

function parseNonNegativeInt(value: string | null, name: string) {
  const parsed = Number.parseInt(value || "0", 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new Error(`request body exceeds ${maxBodyBytes} bytes`);
    }
    chunks.push(buffer);
  }
  if (size === 0) throw new Error("request body is empty");
  return Buffer.concat(chunks);
}

function runUpscale(args: string[]) {
  const { executable } = getPlatformPaths();
  return new Promise<void>((resolveProcess, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("upscale timed out"));
    }, requestTimeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveProcess();
      else reject(new Error(stderr.trim() || `upscayl-bin exited with code ${code}`));
    });
  });
}

async function handleUpscale(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (activeJob) {
    json(response, 429, { error: "another upscale job is currently running" });
    return;
  }
  activeJob = true;
  let jobDir: string | undefined;

  try {
    jobDir = await fs.mkdtemp(join(tmpdir(), "upscayl-api-"));
    const inputPath = join(jobDir, "input");
    const format = parseFormat(url.searchParams.get("format"));
    const model = url.searchParams.get("model") || "upscayl-standard-4x";
    const scale = parseScale(url.searchParams.get("scale"));
    const tileSize = parseNonNegativeInt(url.searchParams.get("tileSize"), "tileSize");
    const compression = parseNonNegativeInt(url.searchParams.get("compression"), "compression");
    const gpuId = url.searchParams.get("gpuId") || "";
    if (!(model in MODELS)) throw new Error(`unknown model: ${model}`);
    const body = await readBody(request);
    const outputPath = join(jobDir, `output.${format}`);
    const { models } = getPlatformPaths();
    await fs.writeFile(inputPath, body);
    const args = [
      "-i", inputPath,
      "-o", outputPath,
      "-m", models,
      "-n", model,
      "-s", scale,
      "-f", format,
      "-c", compression.toString(),
    ];
    if (tileSize > 0) args.push("-t", tileSize.toString());
    if (gpuId) args.push("-g", gpuId);
    if (url.searchParams.get("tta") === "true") args.push("-x");
    await runUpscale(args);
    const output = await fs.readFile(outputPath);
    response.writeHead(200, {
      "Content-Type": contentType(format),
      "Content-Length": output.length,
      "Content-Disposition": `inline; filename="upscaled.${format}"`,
      "Access-Control-Allow-Origin": "*",
    });
    response.end(output);
  } finally {
    activeJob = false;
    if (jobDir) await fs.rm(jobDir, { recursive: true, force: true });
  }
}

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { status: "ok", activeJob });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/models") {
      json(response, 200, { models: Object.keys(MODELS) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/system/resources") {
      json(response, 200, await getSystemResources(projectRoot, activeJob));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/upscale") {
      await handleUpscale(request, response, url);
      return;
    }
    json(response, 404, { error: "not found" });
  } catch (error) {
    if (!response.headersSent) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    } else {
      response.destroy();
    }
  }
});

server.on("error", (error) => {
  console.error("Upscayl API server error:", error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Upscayl API listening on http://${host}:${port}`);
  console.log(`POST /api/upscale?model=upscayl-standard-4x&scale=4&format=png`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
