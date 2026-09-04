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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const models_list_1 = require("../common/models-list");
const system_resources_1 = require("./system-resources");
const host = process.env.API_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.API_PORT || "3000", 10);
const maxBodyBytes = 50 * 1024 * 1024;
const requestTimeoutMs = 10 * 60 * 1000;
let activeJob = false;
const projectRoot = (0, path_1.resolve)(__dirname, "../..");
function getPlatformPaths() {
    if (process.platform === "darwin") {
        return {
            executable: (0, path_1.join)(projectRoot, "resources", "mac", "bin", "upscayl-bin"),
            models: (0, path_1.join)(projectRoot, "resources", "models"),
        };
    }
    if (process.platform === "linux") {
        return {
            executable: (0, path_1.join)(projectRoot, "resources", "linux", "bin", "upscayl-bin"),
            models: (0, path_1.join)(projectRoot, "resources", "models"),
        };
    }
    if (process.platform === "win32") {
        return {
            executable: (0, path_1.join)(projectRoot, "resources", "win", "bin", "upscayl-bin.exe"),
            models: (0, path_1.join)(projectRoot, "resources", "models"),
        };
    }
    throw new Error(`Unsupported platform: ${process.platform}`);
}
function json(response, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*",
    });
    response.end(body);
}
function contentType(format) {
    return format === "jpg" ? "image/jpeg" : `image/${format}`;
}
function parseFormat(value) {
    const format = (value || "png").toLowerCase().replace("jpeg", "jpg");
    if (format !== "png" && format !== "jpg" && format !== "webp") {
        throw new Error("format must be png, jpg, or webp");
    }
    return format;
}
function parseScale(value) {
    const scale = value || "4";
    if (!/^[234]$/.test(scale)) {
        throw new Error("scale must be 2, 3, or 4");
    }
    return scale;
}
function parseNonNegativeInt(value, name) {
    const parsed = Number.parseInt(value || "0", 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer`);
    }
    return parsed;
}
function readBody(request) {
    var _a, request_1, request_1_1;
    var _b, e_1, _c, _d;
    return __awaiter(this, void 0, void 0, function* () {
        const chunks = [];
        let size = 0;
        try {
            for (_a = true, request_1 = __asyncValues(request); request_1_1 = yield request_1.next(), _b = request_1_1.done, !_b;) {
                _d = request_1_1.value;
                _a = false;
                try {
                    const chunk = _d;
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    size += buffer.length;
                    if (size > maxBodyBytes) {
                        throw new Error(`request body exceeds ${maxBodyBytes} bytes`);
                    }
                    chunks.push(buffer);
                }
                finally {
                    _a = true;
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_a && !_b && (_c = request_1.return)) yield _c.call(request_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        if (size === 0)
            throw new Error("request body is empty");
        return Buffer.concat(chunks);
    });
}
function runUpscale(args) {
    const { executable } = getPlatformPaths();
    return new Promise((resolveProcess, reject) => {
        const child = (0, child_process_1.spawn)(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
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
            if (code === 0)
                resolveProcess();
            else
                reject(new Error(stderr.trim() || `upscayl-bin exited with code ${code}`));
        });
    });
}
function handleUpscale(request, response, url) {
    return __awaiter(this, void 0, void 0, function* () {
        if (activeJob) {
            json(response, 429, { error: "another upscale job is currently running" });
            return;
        }
        activeJob = true;
        let jobDir;
        try {
            jobDir = yield fs_1.promises.mkdtemp((0, path_1.join)((0, os_1.tmpdir)(), "upscayl-api-"));
            const inputPath = (0, path_1.join)(jobDir, "input");
            const format = parseFormat(url.searchParams.get("format"));
            const model = url.searchParams.get("model") || "upscayl-standard-4x";
            const scale = parseScale(url.searchParams.get("scale"));
            const tileSize = parseNonNegativeInt(url.searchParams.get("tileSize"), "tileSize");
            const compression = parseNonNegativeInt(url.searchParams.get("compression"), "compression");
            const gpuId = url.searchParams.get("gpuId") || "";
            if (!(model in models_list_1.MODELS))
                throw new Error(`unknown model: ${model}`);
            const body = yield readBody(request);
            const outputPath = (0, path_1.join)(jobDir, `output.${format}`);
            const { models } = getPlatformPaths();
            yield fs_1.promises.writeFile(inputPath, body);
            const args = [
                "-i", inputPath,
                "-o", outputPath,
                "-m", models,
                "-n", model,
                "-s", scale,
                "-f", format,
                "-c", compression.toString(),
            ];
            if (tileSize > 0)
                args.push("-t", tileSize.toString());
            if (gpuId)
                args.push("-g", gpuId);
            if (url.searchParams.get("tta") === "true")
                args.push("-x");
            yield runUpscale(args);
            const output = yield fs_1.promises.readFile(outputPath);
            response.writeHead(200, {
                "Content-Type": contentType(format),
                "Content-Length": output.length,
                "Content-Disposition": `inline; filename="upscaled.${format}"`,
                "Access-Control-Allow-Origin": "*",
            });
            response.end(output);
        }
        finally {
            activeJob = false;
            if (jobDir)
                yield fs_1.promises.rm(jobDir, { recursive: true, force: true });
        }
    });
}
const server = (0, http_1.createServer)((request, response) => __awaiter(void 0, void 0, void 0, function* () {
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
            json(response, 200, { models: Object.keys(models_list_1.MODELS) });
            return;
        }
        if (request.method === "GET" && url.pathname === "/api/system/resources") {
            json(response, 200, yield (0, system_resources_1.getSystemResources)(projectRoot, activeJob));
            return;
        }
        if (request.method === "POST" && url.pathname === "/api/upscale") {
            yield handleUpscale(request, response, url);
            return;
        }
        json(response, 404, { error: "not found" });
    }
    catch (error) {
        if (!response.headersSent) {
            json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        else {
            response.destroy();
        }
    }
}));
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
