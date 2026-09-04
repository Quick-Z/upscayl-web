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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSystemResources = void 0;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const cpuSampleMs = 250;
const commandTimeoutMs = 2000;
const mebibyte = 1024 * 1024;
function percentage(value, total) {
    if (total <= 0)
        return 0;
    return Math.round((value / total) * 1000) / 10;
}
function getSystemUptime() {
    try {
        return os_1.default.uptime();
    }
    catch (_a) {
        return null;
    }
}
function readText(path) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return (yield fs_1.promises.readFile(path, "utf8")).trim();
        }
        catch (_a) {
            return null;
        }
    });
}
function readNumber(path) {
    return __awaiter(this, void 0, void 0, function* () {
        const value = yield readText(path);
        if (!value)
            return null;
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    });
}
function runCommand(command, args) {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(command, args, { timeout: commandTimeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
            const code = error === null || error === void 0 ? void 0 : error.code;
            resolve({
                installed: code !== "ENOENT",
                ok: !error,
                stdout: stdout || "",
            });
        });
    });
}
function getHostAvailableMemory() {
    return __awaiter(this, void 0, void 0, function* () {
        if (process.platform === "linux") {
            const meminfo = yield readText("/proc/meminfo");
            const match = meminfo === null || meminfo === void 0 ? void 0 : meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
            return match ? Number.parseInt(match[1], 10) * 1024 : os_1.default.freemem();
        }
        if (process.platform === "darwin") {
            const result = yield runCommand("memory_pressure", ["-Q"]);
            const match = result.stdout.match(/memory free percentage:\s*(\d+)%/i);
            if (result.ok && match) {
                return Math.floor(os_1.default.totalmem() * Number.parseInt(match[1], 10) / 100);
            }
        }
        return os_1.default.freemem();
    });
}
function getCgroupMemory() {
    return __awaiter(this, void 0, void 0, function* () {
        const v2Limit = yield readText("/sys/fs/cgroup/memory.max");
        const v2Used = yield readNumber("/sys/fs/cgroup/memory.current");
        if (v2Limit && v2Limit !== "max" && v2Used !== null) {
            const limit = Number.parseInt(v2Limit, 10);
            if (Number.isFinite(limit))
                return { limit, used: v2Used };
        }
        const v1Limit = yield readNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes");
        const v1Used = yield readNumber("/sys/fs/cgroup/memory/memory.usage_in_bytes");
        if (v1Limit !== null && v1Used !== null)
            return { limit: v1Limit, used: v1Used };
        return null;
    });
}
function getMemoryResources() {
    return __awaiter(this, void 0, void 0, function* () {
        const hostTotal = os_1.default.totalmem();
        const hostAvailable = yield getHostAvailableMemory();
        const cgroup = yield getCgroupMemory();
        const hasContainerLimit = Boolean(cgroup && cgroup.limit > 0 && cgroup.limit < hostTotal);
        const totalBytes = hasContainerLimit ? cgroup.limit : hostTotal;
        const availableBytes = hasContainerLimit
            ? Math.max(0, Math.min(hostAvailable, cgroup.limit - cgroup.used))
            : hostAvailable;
        const usedBytes = Math.max(0, totalBytes - availableBytes);
        return {
            scope: hasContainerLimit ? "container" : "host",
            totalBytes,
            usedBytes,
            availableBytes,
            usedPercent: percentage(usedBytes, totalBytes),
        };
    });
}
function getCpuSnapshot() {
    return os_1.default.cpus().reduce((snapshot, cpu) => {
        const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
        snapshot.idle += cpu.times.idle;
        snapshot.total += total;
        return snapshot;
    }, { idle: 0, total: 0 });
}
function getCpuQuota(logicalCores) {
    return __awaiter(this, void 0, void 0, function* () {
        const v2CpuMax = yield readText("/sys/fs/cgroup/cpu.max");
        if (v2CpuMax) {
            const [quotaValue, periodValue] = v2CpuMax.split(/\s+/);
            if (quotaValue !== "max") {
                const quota = Number.parseInt(quotaValue, 10);
                const period = Number.parseInt(periodValue, 10);
                if (quota > 0 && period > 0)
                    return Math.min(logicalCores, quota / period);
            }
        }
        const quota = yield readNumber("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
        const period = yield readNumber("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
        if (quota !== null && period !== null && quota > 0 && period > 0) {
            return Math.min(logicalCores, quota / period);
        }
        return logicalCores;
    });
}
function getCgroupCpuUsageMilliseconds() {
    return __awaiter(this, void 0, void 0, function* () {
        const v2Stat = yield readText("/sys/fs/cgroup/cpu.stat");
        const v2Match = v2Stat === null || v2Stat === void 0 ? void 0 : v2Stat.match(/^usage_usec\s+(\d+)$/m);
        if (v2Match)
            return Number.parseInt(v2Match[1], 10) / 1000;
        const v1Usage = yield readNumber("/sys/fs/cgroup/cpuacct/cpuacct.usage");
        return v1Usage === null ? null : v1Usage / 1000000;
    });
}
function getCpuResources() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const cpus = os_1.default.cpus();
        const before = getCpuSnapshot();
        const startedAt = Date.now();
        const [capacityCores, cgroupBefore] = yield Promise.all([
            getCpuQuota(cpus.length),
            getCgroupCpuUsageMilliseconds(),
        ]);
        yield new Promise((resolve) => setTimeout(resolve, cpuSampleMs));
        const after = getCpuSnapshot();
        const cgroupAfter = yield getCgroupCpuUsageMilliseconds();
        const elapsedMilliseconds = Date.now() - startedAt;
        const totalDelta = after.total - before.total;
        const idleDelta = after.idle - before.idle;
        const hasCpuLimit = capacityCores < cpus.length;
        const cgroupUsedPercent = hasCpuLimit && cgroupBefore !== null && cgroupAfter !== null
            ? percentage(cgroupAfter - cgroupBefore, elapsedMilliseconds * capacityCores)
            : null;
        const usedPercent = Math.max(0, Math.min(100, cgroupUsedPercent !== null && cgroupUsedPercent !== void 0 ? cgroupUsedPercent : (totalDelta > 0
            ? percentage(totalDelta - idleDelta, totalDelta)
            : 0)));
        const availablePercent = Math.round((100 - usedPercent) * 10) / 10;
        return {
            scope: cgroupUsedPercent === null ? "host" : "cgroup",
            model: ((_a = cpus[0]) === null || _a === void 0 ? void 0 : _a.model.trim()) || "unknown",
            logicalCores: cpus.length,
            capacityCores: Math.round(capacityCores * 100) / 100,
            usedPercent,
            availablePercent,
            estimatedAvailableCores: Math.round(capacityCores * availablePercent) / 100,
            loadAverage: os_1.default.loadavg(),
            sampleMilliseconds: cpuSampleMs,
        };
    });
}
function getDiskResources(path) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const stats = yield fs_1.promises.statfs(path);
            const totalBytes = stats.blocks * stats.bsize;
            const availableBytes = stats.bavail * stats.bsize;
            const freeBytes = stats.bfree * stats.bsize;
            const usedBytes = Math.max(0, totalBytes - freeBytes);
            return {
                path,
                totalBytes,
                usedBytes,
                availableBytes,
                usedPercent: percentage(usedBytes, totalBytes),
            };
        }
        catch (_a) {
            return {
                path,
                totalBytes: null,
                usedBytes: null,
                availableBytes: null,
                usedPercent: null,
            };
        }
    });
}
function parseNvidiaDevices(output) {
    return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [name, total, used, available, utilization] = line
            .split(",")
            .map((value) => value.trim());
        return {
            name,
            vendor: "NVIDIA",
            deviceId: null,
            driver: "nvidia",
            utilizationPercent: Number.parseFloat(utilization),
            memory: {
                type: "dedicated",
                totalBytes: Number.parseFloat(total) * mebibyte,
                usedBytes: Number.parseFloat(used) * mebibyte,
                availableBytes: Number.parseFloat(available) * mebibyte,
            },
        };
    });
}
function parseUevent(value) {
    const result = {};
    for (const line of (value === null || value === void 0 ? void 0 : value.split("\n")) || []) {
        const separator = line.indexOf("=");
        if (separator > 0)
            result[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return result;
}
function gpuVendorName(vendorId) {
    if (vendorId === "0x8086")
        return "Intel";
    if (vendorId === "0x10de")
        return "NVIDIA";
    if (vendorId === "0x1002")
        return "AMD";
    return vendorId;
}
function getLinuxDrmDevices(skipNvidia) {
    return __awaiter(this, void 0, void 0, function* () {
        if (process.platform !== "linux")
            return [];
        try {
            const entries = yield fs_1.promises.readdir("/sys/class/drm");
            const devices = yield Promise.all(entries
                .filter((entry) => /^card\d+$/.test(entry))
                .map((entry) => __awaiter(this, void 0, void 0, function* () {
                const devicePath = `/sys/class/drm/${entry}/device`;
                const vendorId = yield readText(`${devicePath}/vendor`);
                const vendor = gpuVendorName(vendorId);
                if (skipNvidia && vendor === "NVIDIA")
                    return null;
                const deviceId = yield readText(`${devicePath}/device`);
                const uevent = parseUevent(yield readText(`${devicePath}/uevent`));
                const totalBytes = yield readNumber(`${devicePath}/mem_info_vram_total`);
                const usedBytes = yield readNumber(`${devicePath}/mem_info_vram_used`);
                const sharedMemory = vendor === "Intel" || totalBytes === null;
                return {
                    name: uevent.PCI_ID
                        ? `${vendor || "GPU"} ${uevent.PCI_ID}`
                        : `${vendor || "GPU"} ${entry}`,
                    vendor,
                    deviceId,
                    driver: uevent.DRIVER || null,
                    utilizationPercent: null,
                    memory: {
                        type: sharedMemory ? "shared" : "dedicated",
                        totalBytes,
                        usedBytes,
                        availableBytes: totalBytes !== null && usedBytes !== null
                            ? Math.max(0, totalBytes - usedBytes)
                            : null,
                    },
                };
            })));
            return devices.filter((device) => device !== null);
        }
        catch (_a) {
            return [];
        }
    });
}
function getMacGpuDevices() {
    return __awaiter(this, void 0, void 0, function* () {
        if (process.platform !== "darwin")
            return [];
        const result = yield runCommand("system_profiler", ["SPDisplaysDataType", "-json"]);
        if (!result.ok)
            return [];
        try {
            const parsed = JSON.parse(result.stdout);
            return (parsed.SPDisplaysDataType || []).map((device) => {
                var _a;
                return ({
                    name: device.sppci_model || device._name || "Apple GPU",
                    vendor: ((_a = device.spdisplays_vendor) === null || _a === void 0 ? void 0 : _a.includes("Apple")) ? "Apple" : null,
                    deviceId: null,
                    driver: device.spdisplays_metal ? "Metal" : null,
                    utilizationPercent: null,
                    memory: {
                        type: "shared",
                        totalBytes: null,
                        usedBytes: null,
                        availableBytes: null,
                    },
                });
            });
        }
        catch (_a) {
            return [];
        }
    });
}
function parseVulkanDevices(output) {
    return output
        .split("\n")
        .map((line) => { var _a, _b; return (_b = (_a = line.match(/^\s*deviceName\s*=\s*(.+)$/)) === null || _a === void 0 ? void 0 : _a[1]) === null || _b === void 0 ? void 0 : _b.trim(); })
        .filter((name) => Boolean(name));
}
function getGpuResources() {
    return __awaiter(this, void 0, void 0, function* () {
        const [nvidia, vulkan] = yield Promise.all([
            runCommand("nvidia-smi", [
                "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu",
                "--format=csv,noheader,nounits",
            ]),
            runCommand("vulkaninfo", ["--summary"]),
        ]);
        const nvidiaDevices = nvidia.ok ? parseNvidiaDevices(nvidia.stdout) : [];
        const [drmDevices, macDevices] = yield Promise.all([
            getLinuxDrmDevices(nvidiaDevices.length > 0),
            getMacGpuDevices(),
        ]);
        const devices = [...nvidiaDevices, ...drmDevices, ...macDevices];
        const hasSharedMemory = devices.some((device) => device.memory.type === "shared");
        return {
            detected: devices.length > 0,
            devices,
            vulkan: {
                toolInstalled: vulkan.installed,
                available: vulkan.ok,
                devices: vulkan.ok ? parseVulkanDevices(vulkan.stdout) : [],
            },
            note: hasSharedMemory
                ? "Integrated GPUs share system memory, so dedicated free GPU memory is not available."
                : null,
        };
    });
}
function getSystemResources(projectRoot, activeJob) {
    return __awaiter(this, void 0, void 0, function* () {
        const [memory, cpu, disk, gpu] = yield Promise.all([
            getMemoryResources(),
            getCpuResources(),
            getDiskResources(projectRoot),
            getGpuResources(),
        ]);
        const processMemory = process.memoryUsage();
        return {
            timestamp: new Date().toISOString(),
            platform: process.platform,
            arch: process.arch,
            uptimeSeconds: getSystemUptime(),
            activeJob,
            memory,
            cpu,
            disk,
            gpu,
            process: {
                pid: process.pid,
                uptimeSeconds: process.uptime(),
                rssBytes: processMemory.rss,
                heapUsedBytes: processMemory.heapUsed,
                heapTotalBytes: processMemory.heapTotal,
                externalBytes: processMemory.external,
            },
        };
    });
}
exports.getSystemResources = getSystemResources;
