"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const os_1 = require("os");
const path_1 = require("path");
const crypto_1 = require("crypto");
const models_list_1 = require("../common/models-list");
const system_resources_1 = require("./system-resources");
const host = process.env.API_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.API_PORT || "3000", 10);
const maxBodyBytes = 50 * 1024 * 1024;
const requestTimeoutMs = 10 * 60 * 1000;
const maxQueueSize = Math.max(1, Number.parseInt(process.env.API_MAX_QUEUE || "100", 10));
const concurrency = Math.max(1, Number.parseInt(process.env.API_CONCURRENCY || "1", 10));
const projectRoot = (0, path_1.resolve)(__dirname, "../..");
const jobs = new Map();
const queue = [];
let running = 0;
let shuttingDown = false;
function cleanupExpired() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const now = Date.now();
        for (const [id, job] of jobs) {
            if (!job.finishedAt)
                continue;
            const expiresAt = ((_a = job.output) === null || _a === void 0 ? void 0 : _a.expiresAt) ? Date.parse(job.output.expiresAt) : Date.parse(job.finishedAt) + 1800000;
            if (expiresAt > now)
                continue;
            if (job.subscribers.size)
                continue;
            yield fs_1.promises.rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
            jobs.delete(id);
        }
    });
}
function paths() { if (process.platform === "darwin")
    return { executable: (0, path_1.join)(projectRoot, "resources/mac/bin/upscayl-bin"), models: (0, path_1.join)(projectRoot, "resources/models") }; if (process.platform === "linux")
    return { executable: (0, path_1.join)(projectRoot, "resources/linux/bin/upscayl-bin"), models: (0, path_1.join)(projectRoot, "resources/models") }; if (process.platform === "win32")
    return { executable: (0, path_1.join)(projectRoot, "resources/win/bin/upscayl-bin.exe"), models: (0, path_1.join)(projectRoot, "resources/models") }; throw new Error(`Unsupported platform: ${process.platform}`); }
function json(res, status, value, extra = {}) { const body = JSON.stringify(value); res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body).toString(), "Access-Control-Allow-Origin": "*" }, extra)); res.end(body); }
function fail(res, status, code, message, retryable = false) { json(res, status, { error: { code, message, retryable } }); }
function mimeFor(format) { return format === "jpg" ? "image/jpeg" : `image/${format}`; }
function parseFormat(v) { const f = (v || "png").toLowerCase().replace("jpeg", "jpg"); if (!["png", "jpg", "webp"].includes(f))
    throw new Error("format must be png, jpg, or webp"); return f; }
function parseScale(v) { const s = v || "4"; if (!/^[234]$/.test(s))
    throw new Error("scale must be 2, 3, or 4"); return s; }
function nonNegative(v, name) { const n = Number.parseInt(v || "0", 10); if (!Number.isInteger(n) || n < 0)
    throw new Error(`${name} must be a non-negative integer`); return n; }
function filename(v, mime) { const fallback = mime === "image/jpeg" ? "image.jpg" : mime === "image/webp" ? "image.webp" : "image.png"; return ((v || fallback).replace(/[\\/\0]/g, "_").trim() || fallback).slice(0, 255); }
function streamBody(req, target) {
    return __awaiter(this, void 0, void 0, function* () { return new Promise((resolveBody, reject) => { let size = 0; const out = (0, fs_1.createWriteStream)(target, { flags: "wx" }); const rejectOnce = (e) => { out.destroy(); reject(e); }; req.on("data", (chunk) => { size += chunk.length; if (size > maxBodyBytes) {
        req.destroy();
        rejectOnce(new Error("request body exceeds 50 MB"));
        return;
    } out.write(chunk); }); req.on("end", () => out.end(() => size ? resolveBody(size) : rejectOnce(new Error("request body is empty")))); req.on("aborted", () => rejectOnce(new Error("upload aborted"))); req.on("error", rejectOnce); }); });
}
function view(job) { return { id: job.id, status: job.status, stage: job.stage, progress: job.progress, position: job.status === "queued" ? queue.indexOf(job.id) + 1 : null, createdAt: job.createdAt, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null, config: job.config, input: { filename: job.input.filename, size: job.input.size, mime: job.input.mime }, output: job.output ? { url: job.output.url, filename: job.output.filename, mime: job.output.mime, size: job.output.size, expiresAt: job.output.expiresAt } : null, error: job.error || null }; }
function publish(job) { const data = `event: job\ndata: ${JSON.stringify({ job: view(job) })}\n\n`; for (const res of job.subscribers)
    try {
        res.write(data);
    }
    catch (_a) {
        job.subscribers.delete(res);
    } }
function run(job, args) { const { executable } = paths(); return new Promise((resolveRun, rejectRun) => { var _a; const child = (0, child_process_1.spawn)(executable, args, { stdio: ["ignore", "pipe", "pipe"] }); job.child = child; let stderr = ""; (_a = child.stderr) === null || _a === void 0 ? void 0 : _a.on("data", d => { stderr += d.toString(); }); const timeout = setTimeout(() => { child.kill("SIGKILL"); rejectRun(Object.assign(new Error("upscale timed out"), { code: "TIMEOUT" })); }, requestTimeoutMs); child.once("error", e => { clearTimeout(timeout); rejectRun(e); }); child.once("close", code => { clearTimeout(timeout); code === 0 ? resolveRun() : rejectRun(new Error(stderr.trim() || `upscayl-bin exited with code ${code}`)); }); }); }
function execute(job) {
    return __awaiter(this, void 0, void 0, function* () { running++; job.status = "running"; job.stage = "upscaling"; job.progress = 10; job.startedAt = new Date().toISOString(); publish(job); const format = job.config.format; const outputPath = (0, path_1.join)(job.dir, `output.${format}`); const p = paths(); const args = ["-i", job.input.path, "-o", outputPath, "-m", p.models, "-n", String(job.config.model), "-s", String(job.config.scale), "-f", format, "-c", String(job.config.compression)]; if (Number(job.config.tileSize) > 0)
        args.push("-t", String(job.config.tileSize)); if (job.config.gpuId)
        args.push("-g", String(job.config.gpuId)); if (job.config.tta === true)
        args.push("-x"); try {
        yield run(job, args);
        if (job.cancelRequested)
            throw Object.assign(new Error("job canceled"), { code: "CANCELED" });
        job.stage = "encoding";
        job.progress = 95;
        publish(job);
        const stat = yield fs_1.promises.stat(outputPath);
        const outName = `${job.input.filename.replace(/\.[^.]+$/, "")}-upscaled.${format}`;
        job.output = { path: outputPath, url: `/api/jobs/${job.id}/result`, filename: outName, mime: mimeFor(format), size: stat.size, expiresAt: new Date(Date.now() + 1800000).toISOString() };
        job.status = "succeeded";
        job.stage = "completed";
        job.progress = 100;
    }
    catch (e) {
        if (job.cancelRequested || e.code === "CANCELED") {
            job.status = "canceled";
            job.stage = "canceled";
        }
        else {
            job.status = "failed";
            job.stage = "failed";
            job.error = { code: e.code || "UPSCALE_FAILED", message: e instanceof Error ? e.message : String(e), retryable: true };
        }
    }
    finally {
        job.finishedAt = new Date().toISOString();
        job.child = undefined;
        running--;
        publish(job);
        pump();
    } });
}
function pump() { while (!shuttingDown && running < concurrency && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if ((job === null || job === void 0 ? void 0 : job.status) === "queued")
        void execute(job);
} }
function getJob(id, res) { const job = jobs.get(id); if (!job) {
    fail(res, 404, "JOB_NOT_FOUND", "Job not found");
    return;
} return job; }
function createJob(req, res, url) {
    return __awaiter(this, void 0, void 0, function* () { if (shuttingDown)
        return fail(res, 503, "SHUTTING_DOWN", "Server is shutting down", true); if (queue.length + running >= maxQueueSize)
        return fail(res, 429, "QUEUE_FULL", "The processing queue is full", true); const mime = String(req.headers["content-type"] || "").split(";")[0].toLowerCase(); if (!["image/png", "image/jpeg", "image/webp"].includes(mime))
        return fail(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Only PNG, JPEG, and WEBP images are supported"); let dir; try {
        const model = url.searchParams.get("model") || "upscayl-standard-4x";
        if (!(model in models_list_1.MODELS))
            throw new Error(`Unknown model: ${model}`);
        const config = { model, scale: parseScale(url.searchParams.get("scale")), format: parseFormat(url.searchParams.get("format")), tileSize: nonNegative(url.searchParams.get("tileSize"), "tileSize"), compression: nonNegative(url.searchParams.get("compression"), "compression"), gpuId: url.searchParams.get("gpuId") || "", tta: url.searchParams.get("tta") === "true" };
        const id = (0, crypto_1.randomUUID)();
        dir = yield fs_1.promises.mkdtemp((0, path_1.join)((0, os_1.tmpdir)(), `upscayl-job-${id}-`));
        const inputPath = (0, path_1.join)(dir, "input");
        yield streamBody(req, inputPath);
        const stat = yield fs_1.promises.stat(inputPath);
        const job = { id, status: "queued", stage: "queued", progress: 0, createdAt: new Date().toISOString(), config, input: { filename: filename(req.headers["x-file-name"], mime), size: stat.size, mime, path: inputPath }, dir, subscribers: new Set() };
        jobs.set(id, job);
        queue.push(id);
        publish(job);
        pump();
        return json(res, 202, { job: view(job) });
    }
    catch (e) {
        if (dir)
            yield fs_1.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        const message = e instanceof Error ? e.message : String(e);
        return fail(res, message.includes("50 MB") ? 413 : 422, message.includes("50 MB") ? "PAYLOAD_TOO_LARGE" : "INVALID_JOB", message);
    } });
}
function events(req, res, job) { res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" }); res.write(`event: job\ndata: ${JSON.stringify({ job: view(job) })}\n\n`); job.subscribers.add(res); const timer = setInterval(() => { try {
    res.write(": heartbeat\n\n");
}
catch (_a) {
    clearInterval(timer);
} }, 15000); req.on("close", () => { clearInterval(timer); job.subscribers.delete(res); }); if (["succeeded", "failed", "canceled"].includes(job.status)) {
    clearInterval(timer);
    job.subscribers.delete(res);
    res.end();
} }
function result(res, job) {
    return __awaiter(this, void 0, void 0, function* () { if (job.status !== "succeeded" || !job.output)
        return fail(res, 409, "RESULT_NOT_READY", "Result is not ready", true); try {
        const stat = yield fs_1.promises.stat(job.output.path);
        res.writeHead(200, { "Content-Type": job.output.mime, "Content-Length": stat.size.toString(), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.output.filename)}`, "Access-Control-Allow-Origin": "*" });
        (0, fs_1.createReadStream)(job.output.path).pipe(res);
    }
    catch (_a) {
        fail(res, 410, "RESULT_EXPIRED", "Result is no longer available");
    } });
}
function cancel(res, job) { var _a; if (["succeeded", "failed", "canceled"].includes(job.status))
    return json(res, 200, { job: view(job) }); job.cancelRequested = true; if (job.status === "queued") {
    const i = queue.indexOf(job.id);
    if (i >= 0)
        queue.splice(i, 1);
    job.status = "canceled";
    job.stage = "canceled";
    job.finishedAt = new Date().toISOString();
    publish(job);
}
else
    (_a = job.child) === null || _a === void 0 ? void 0 : _a.kill("SIGTERM"); json(res, 202, { job: view(job) }); }
const server = (0, http_1.createServer)((req, res) => __awaiter(void 0, void 0, void 0, function* () { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-File-Name,Idempotency-Key"); if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
} const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`); const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(events|result))?$/); try {
    if (req.method === "GET" && url.pathname === "/health")
        return json(res, 200, { status: "ok", queueDepth: queue.length, running, concurrency, capacity: maxQueueSize });
    if (req.method === "GET" && url.pathname === "/api/models")
        return json(res, 200, { models: Object.keys(models_list_1.MODELS) });
    if (req.method === "GET" && url.pathname === "/api/system/resources")
        return json(res, 200, Object.assign(Object.assign({}, (yield (0, system_resources_1.getSystemResources)(projectRoot, running > 0))), { queueDepth: queue.length, running, concurrency }));
    if (req.method === "POST" && url.pathname === "/api/jobs")
        return createJob(req, res, url);
    if (match) {
        const job = getJob(match[1], res);
        if (!job)
            return;
        if (req.method === "GET" && match[2] === "events")
            return events(req, res, job);
        if (req.method === "GET" && match[2] === "result")
            return result(res, job);
        if (req.method === "GET" && !match[2])
            return json(res, 200, { job: view(job) });
        if (req.method === "DELETE" && !match[2])
            return cancel(res, job);
    }
    return fail(res, 404, "NOT_FOUND", "Route not found");
}
catch (e) {
    if (!res.headersSent)
        fail(res, 400, "BAD_REQUEST", e instanceof Error ? e.message : String(e));
    else
        res.destroy();
} }));
function shutdown() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () { shuttingDown = true; for (const job of jobs.values())
        if (job.status === "running") {
            job.cancelRequested = true;
            (_a = job.child) === null || _a === void 0 ? void 0 : _a.kill("SIGTERM");
        } server.close(() => process.exit(0)); });
}
server.listen(port, host, () => console.log(`Upscayl API listening on http://${host}:${port}`));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
const cleanupTimer = setInterval(() => { void cleanupExpired(); }, 60000);
cleanupTimer.unref();
