import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";

const cpuSampleMs = 250;
const commandTimeoutMs = 2_000;
const mebibyte = 1024 * 1024;

type CommandResult = {
  installed: boolean;
  ok: boolean;
  stdout: string;
};

type GpuDevice = {
  name: string;
  vendor: string | null;
  deviceId: string | null;
  driver: string | null;
  utilizationPercent: number | null;
  memory: {
    type: "dedicated" | "shared" | "unknown";
    totalBytes: number | null;
    usedBytes: number | null;
    availableBytes: number | null;
  };
};

function percentage(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1_000) / 10;
}

function getSystemUptime() {
  try {
    return os.uptime();
  } catch {
    return null;
  }
}

async function readText(path: string) {
  try {
    return (await fs.readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

async function readNumber(path: string) {
  const value = await readText(path);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function runCommand(command: string, args: string[]) {
  return new Promise<CommandResult>((resolve) => {
    execFile(
      command,
      args,
      { timeout: commandTimeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        resolve({
          installed: code !== "ENOENT",
          ok: !error,
          stdout: stdout || "",
        });
      },
    );
  });
}

async function getHostAvailableMemory() {
  if (process.platform === "linux") {
    const meminfo = await readText("/proc/meminfo");
    const match = meminfo?.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return match ? Number.parseInt(match[1], 10) * 1024 : os.freemem();
  }
  if (process.platform === "darwin") {
    const result = await runCommand("memory_pressure", ["-Q"]);
    const match = result.stdout.match(/memory free percentage:\s*(\d+)%/i);
    if (result.ok && match) {
      return Math.floor(os.totalmem() * Number.parseInt(match[1], 10) / 100);
    }
  }
  return os.freemem();
}

async function getCgroupMemory() {
  const v2Limit = await readText("/sys/fs/cgroup/memory.max");
  const v2Used = await readNumber("/sys/fs/cgroup/memory.current");
  if (v2Limit && v2Limit !== "max" && v2Used !== null) {
    const limit = Number.parseInt(v2Limit, 10);
    if (Number.isFinite(limit)) return { limit, used: v2Used };
  }

  const v1Limit = await readNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const v1Used = await readNumber("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  if (v1Limit !== null && v1Used !== null) return { limit: v1Limit, used: v1Used };
  return null;
}

async function getMemoryResources() {
  const hostTotal = os.totalmem();
  const hostAvailable = await getHostAvailableMemory();
  const cgroup = await getCgroupMemory();
  const hasContainerLimit = Boolean(
    cgroup && cgroup.limit > 0 && cgroup.limit < hostTotal,
  );
  const totalBytes = hasContainerLimit ? cgroup!.limit : hostTotal;
  const availableBytes = hasContainerLimit
    ? Math.max(0, Math.min(hostAvailable, cgroup!.limit - cgroup!.used))
    : hostAvailable;
  const usedBytes = Math.max(0, totalBytes - availableBytes);

  return {
    scope: hasContainerLimit ? "container" : "host",
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent: percentage(usedBytes, totalBytes),
  };
}

function getCpuSnapshot() {
  return os.cpus().reduce(
    (snapshot, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      snapshot.idle += cpu.times.idle;
      snapshot.total += total;
      return snapshot;
    },
    { idle: 0, total: 0 },
  );
}

async function getCpuQuota(logicalCores: number) {
  const v2CpuMax = await readText("/sys/fs/cgroup/cpu.max");
  if (v2CpuMax) {
    const [quotaValue, periodValue] = v2CpuMax.split(/\s+/);
    if (quotaValue !== "max") {
      const quota = Number.parseInt(quotaValue, 10);
      const period = Number.parseInt(periodValue, 10);
      if (quota > 0 && period > 0) return Math.min(logicalCores, quota / period);
    }
  }

  const quota = await readNumber("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
  const period = await readNumber("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
  if (quota !== null && period !== null && quota > 0 && period > 0) {
    return Math.min(logicalCores, quota / period);
  }
  return logicalCores;
}

async function getCgroupCpuUsageMilliseconds() {
  const v2Stat = await readText("/sys/fs/cgroup/cpu.stat");
  const v2Match = v2Stat?.match(/^usage_usec\s+(\d+)$/m);
  if (v2Match) return Number.parseInt(v2Match[1], 10) / 1000;

  const v1Usage = await readNumber("/sys/fs/cgroup/cpuacct/cpuacct.usage");
  return v1Usage === null ? null : v1Usage / 1_000_000;
}

async function getCpuResources() {
  const cpus = os.cpus();
  const before = getCpuSnapshot();
  const startedAt = Date.now();
  const [capacityCores, cgroupBefore] = await Promise.all([
    getCpuQuota(cpus.length),
    getCgroupCpuUsageMilliseconds(),
  ]);
  await new Promise((resolve) => setTimeout(resolve, cpuSampleMs));
  const after = getCpuSnapshot();
  const cgroupAfter = await getCgroupCpuUsageMilliseconds();
  const elapsedMilliseconds = Date.now() - startedAt;
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  const hasCpuLimit = capacityCores < cpus.length;
  const cgroupUsedPercent = hasCpuLimit && cgroupBefore !== null && cgroupAfter !== null
    ? percentage(cgroupAfter - cgroupBefore, elapsedMilliseconds * capacityCores)
    : null;
  const usedPercent = Math.max(0, Math.min(100,
    cgroupUsedPercent ?? (totalDelta > 0
      ? percentage(totalDelta - idleDelta, totalDelta)
      : 0),
  ));
  const availablePercent = Math.round((100 - usedPercent) * 10) / 10;

  return {
    scope: cgroupUsedPercent === null ? "host" : "cgroup",
    model: cpus[0]?.model.trim() || "unknown",
    logicalCores: cpus.length,
    capacityCores: Math.round(capacityCores * 100) / 100,
    usedPercent,
    availablePercent,
    estimatedAvailableCores: Math.round(capacityCores * availablePercent) / 100,
    loadAverage: os.loadavg(),
    sampleMilliseconds: cpuSampleMs,
  };
}

async function getDiskResources(path: string) {
  try {
    const stats = await fs.statfs(path);
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
  } catch {
    return {
      path,
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      usedPercent: null,
    };
  }
}

function parseNvidiaDevices(output: string): GpuDevice[] {
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
          type: "dedicated" as const,
          totalBytes: Number.parseFloat(total) * mebibyte,
          usedBytes: Number.parseFloat(used) * mebibyte,
          availableBytes: Number.parseFloat(available) * mebibyte,
        },
      };
    });
}

function parseUevent(value: string | null) {
  const result: Record<string, string> = {};
  for (const line of value?.split("\n") || []) {
    const separator = line.indexOf("=");
    if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

function gpuVendorName(vendorId: string | null) {
  if (vendorId === "0x8086") return "Intel";
  if (vendorId === "0x10de") return "NVIDIA";
  if (vendorId === "0x1002") return "AMD";
  return vendorId;
}

async function getLinuxDrmDevices(skipNvidia: boolean): Promise<GpuDevice[]> {
  if (process.platform !== "linux") return [];
  try {
    const entries = await fs.readdir("/sys/class/drm");
    const devices = await Promise.all(
      entries
        .filter((entry) => /^card\d+$/.test(entry))
        .map(async (entry): Promise<GpuDevice | null> => {
          const devicePath = `/sys/class/drm/${entry}/device`;
          const vendorId = await readText(`${devicePath}/vendor`);
          const vendor = gpuVendorName(vendorId);
          if (skipNvidia && vendor === "NVIDIA") return null;
          const deviceId = await readText(`${devicePath}/device`);
          const uevent = parseUevent(await readText(`${devicePath}/uevent`));
          const totalBytes = await readNumber(`${devicePath}/mem_info_vram_total`);
          const usedBytes = await readNumber(`${devicePath}/mem_info_vram_used`);
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
        }),
    );
    return devices.filter((device): device is GpuDevice => device !== null);
  } catch {
    return [];
  }
}

async function getMacGpuDevices(): Promise<GpuDevice[]> {
  if (process.platform !== "darwin") return [];
  const result = await runCommand("system_profiler", ["SPDisplaysDataType", "-json"]);
  if (!result.ok) return [];
  try {
    const parsed = JSON.parse(result.stdout) as {
      SPDisplaysDataType?: Array<Record<string, string>>;
    };
    return (parsed.SPDisplaysDataType || []).map((device) => ({
      name: device.sppci_model || device._name || "Apple GPU",
      vendor: device.spdisplays_vendor?.includes("Apple") ? "Apple" : null,
      deviceId: null,
      driver: device.spdisplays_metal ? "Metal" : null,
      utilizationPercent: null,
      memory: {
        type: "shared" as const,
        totalBytes: null,
        usedBytes: null,
        availableBytes: null,
      },
    }));
  } catch {
    return [];
  }
}

function parseVulkanDevices(output: string) {
  return output
    .split("\n")
    .map((line) => line.match(/^\s*deviceName\s*=\s*(.+)$/)?.[1]?.trim())
    .filter((name): name is string => Boolean(name));
}

async function getGpuResources() {
  const [nvidia, vulkan] = await Promise.all([
    runCommand("nvidia-smi", [
      "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu",
      "--format=csv,noheader,nounits",
    ]),
    runCommand("vulkaninfo", ["--summary"]),
  ]);
  const nvidiaDevices = nvidia.ok ? parseNvidiaDevices(nvidia.stdout) : [];
  const [drmDevices, macDevices] = await Promise.all([
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
}

export async function getSystemResources(projectRoot: string, activeJob: boolean) {
  const [memory, cpu, disk, gpu] = await Promise.all([
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
}
