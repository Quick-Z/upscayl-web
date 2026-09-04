# Upscayl HTTP API 对接文档

本文档说明如何启动 Upscayl HTTP 服务、如何传入图片和扩图参数，以及每个内置模型适合的使用场景。

该服务不启动 Electron 窗口，而是直接调用项目内的 `upscayl-bin` 和 `resources/models` 完成图片放大。调用方把图片作为 HTTP 请求体发送，服务处理完成后直接返回扩图后的图片二进制。

## 1. 启动服务

在项目根目录执行：

```bash
npm run api
```

默认监听地址为：

```text
http://127.0.0.1:3000
```

也可以通过环境变量修改监听地址和端口：

```bash
API_HOST=0.0.0.0 API_PORT=8080 npm run api
```

Windows PowerShell：

```powershell
$env:API_HOST="0.0.0.0"
$env:API_PORT="8080"
npm run api
```

默认的 `127.0.0.1` 只允许本机访问。对局域网或公网开放前，请先配置反向代理、HTTPS 和鉴权。

## 2. 接口总览

| 方法 | 路径 | 用途 | 成功响应 |
| --- | --- | --- | --- |
| `GET` | `/health` | 检查服务是否在线 | JSON |
| `GET` | `/api/models` | 获取可用模型名称 | JSON |
| `GET` | `/api/system/resources` | 获取当前环境的 CPU、内存、磁盘和 GPU 资源 | JSON |
| `POST` | `/api/upscale` | 执行一次图片扩图 | 图片二进制 |

服务还支持 `OPTIONS` 预检请求，并返回 CORS 响应头。

## 3. 健康检查

### 请求

```http
GET /health
```

### curl

```bash
curl http://127.0.0.1:3000/health
```

### 响应

```json
{
  "status": "ok",
  "activeJob": false
}
```

- `status`：服务正常时为 `ok`。
- `activeJob`：是否正在处理扩图任务。`true` 表示已有任务执行中。

## 4. 获取模型列表

### 请求

```http
GET /api/models
```

### curl

```bash
curl http://127.0.0.1:3000/api/models
```

### 响应

```json
{
  "models": [
    "upscayl-standard-4x",
    "upscayl-lite-4x",
    "high-fidelity-4x",
    "remacri-4x",
    "ultramix-balanced-4x",
    "ultrasharp-4x",
    "digital-art-4x"
  ]
}
```

`models` 中的字符串就是扩图接口 `model` 参数允许使用的值，名称必须完全匹配。

## 5. 获取系统资源

### 请求

```http
GET /api/system/resources
```

### curl

```bash
curl http://127.0.0.1:3000/api/system/resources
```

### 响应示例

```json
{
  "timestamp": "2026-09-04T06:30:00.000Z",
  "platform": "linux",
  "arch": "x64",
  "uptimeSeconds": 86400,
  "activeJob": false,
  "memory": {
    "scope": "container",
    "totalBytes": 8589934592,
    "usedBytes": 3221225472,
    "availableBytes": 5368709120,
    "usedPercent": 37.5
  },
  "cpu": {
    "scope": "cgroup",
    "model": "12th Gen Intel(R) Core(TM) i3-1215U",
    "logicalCores": 8,
    "capacityCores": 8,
    "usedPercent": 18.4,
    "availablePercent": 81.6,
    "estimatedAvailableCores": 6.53,
    "loadAverage": [0.42, 0.31, 0.25],
    "sampleMilliseconds": 250
  },
  "disk": {
    "path": "/app",
    "totalBytes": 107374182400,
    "usedBytes": 42949672960,
    "availableBytes": 64424509440,
    "usedPercent": 40
  },
  "gpu": {
    "detected": true,
    "devices": [
      {
        "name": "Intel 8086:46b3",
        "vendor": "Intel",
        "deviceId": "0x46b3",
        "driver": "i915",
        "utilizationPercent": null,
        "memory": {
          "type": "shared",
          "totalBytes": null,
          "usedBytes": null,
          "availableBytes": null
        }
      }
    ],
    "vulkan": {
      "toolInstalled": true,
      "available": true,
      "devices": ["Intel(R) UHD Graphics"]
    },
    "note": "Integrated GPUs share system memory, so dedicated free GPU memory is not available."
  },
  "process": {
    "pid": 1234,
    "uptimeSeconds": 120,
    "rssBytes": 73400320,
    "heapUsedBytes": 12582912,
    "heapTotalBytes": 20971520,
    "externalBytes": 1835008
  }
}
```

- 所有容量字段均使用字节。
- 个别系统指标因容器权限无法读取时会返回 `null`，不会导致整个接口失败。
- `memory.scope` 为 `container` 时，数据按 Docker cgroup 内存上限计算；否则为宿主机资源。
- `cpu.scope` 为 `cgroup` 时，使用率按当前容器的 CPU 计数和配额计算；否则采样宿主机 CPU。`capacityCores` 会考虑 Docker CPU 配额，`availablePercent` 和 `estimatedAvailableCores` 是瞬时估算值。
- NVIDIA GPU 在可使用 `nvidia-smi` 时会返回显存和利用率。Intel 等共享内存核显无法可靠区分独立显存，因此相关字段返回 `null`。
- `gpu.vulkan.available` 依赖运行环境中安装 `vulkaninfo`。若未安装 `vulkan-tools`，`toolInstalled` 为 `false`，不代表 GPU 一定不支持 Vulkan。

## 6. 图片扩图接口

### 请求

```http
POST /api/upscale
```

图片必须作为请求体直接发送，不使用 JSON，也不使用 `multipart/form-data`。建议设置正确的 `Content-Type`，例如 `image/png`、`image/jpeg` 或 `image/webp`。

### URL 参数

完整请求示例：

```text
/api/upscale?model=upscayl-standard-4x&scale=4&format=png
```

| 参数 | 必填 | 默认值 | 可选值/格式 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | 否 | `upscayl-standard-4x` | 见模型列表 | AI 模型名称，必须完全匹配。 |
| `scale` | 否 | `4` | `2`、`3`、`4` | 输出放大倍数。 |
| `format` | 否 | `png` | `png`、`jpg`、`webp` | 输出格式；`jpeg` 也会识别为 `jpg`。 |
| `tileSize` | 否 | `0` | 非负整数 | 分块大小。`0` 为自动；显存不足时可尝试 `32`、`64`、`128`。 |
| `compression` | 否 | `0` | 非负整数 | 输出压缩参数，通常使用 `0` 到 `100`。 |
| `gpuId` | 否 | 空 | 字符串，如 `0` | 指定 GPU；留空由底层程序自动选择。 |
| `tta` | 否 | `false` | `true` | `tta=true` 时启用 TTA，通常质量更高但速度更慢。 |

服务限制：单个请求体最大 50 MB，单个任务最长 10 分钟。服务会把图片写入临时目录，处理完成后自动删除临时文件。

### 最小 curl 示例

```bash
curl -X POST \
  "http://127.0.0.1:3000/api/upscale" \
  -H "Content-Type: image/png" \
  --data-binary "@input.png" \
  --output output.png
```

### 指定模型和参数

```bash
curl -X POST \
  "http://127.0.0.1:3000/api/upscale?model=high-fidelity-4x&scale=4&format=webp&tileSize=128&compression=80&tta=true" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@input.jpg" \
  --output output.webp
```

### 成功响应

成功时返回 HTTP `200`，响应体就是图片二进制，不是 JSON。

响应头示例：

```http
Content-Type: image/png
Content-Disposition: inline; filename="upscaled.png"
```

调用方应根据响应的 `Content-Type` 或请求时的 `format` 保存文件。

### Node.js 示例

Node.js 18 及以上可使用内置 `fetch`：

```js
import { readFile, writeFile } from "node:fs/promises";

const input = await readFile("input.png");
const url = new URL("http://127.0.0.1:3000/api/upscale");
url.searchParams.set("model", "upscayl-standard-4x");
url.searchParams.set("scale", "4");
url.searchParams.set("format", "png");

const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "image/png" },
  body: input,
});

if (!response.ok) throw new Error(await response.text());
await writeFile("output.png", Buffer.from(await response.arrayBuffer()));
```

### Python 示例

下面示例使用 `requests`：

```python
import requests

with open("input.png", "rb") as image_file:
    response = requests.post(
        "http://127.0.0.1:3000/api/upscale",
        params={
            "model": "upscayl-standard-4x",
            "scale": "4",
            "format": "png",
        },
        headers={"Content-Type": "image/png"},
        data=image_file,
        timeout=660,
    )

response.raise_for_status()
with open("output.png", "wb") as output_file:
    output_file.write(response.content)
```

## 7. 错误响应

错误时返回 JSON：

```json
{
  "error": "unknown model: not-a-model"
}
```

常见状态码：

| HTTP 状态码 | 场景 |
| --- | --- |
| `400` | 参数错误、图片为空、图片超过 50 MB、模型不存在，或底层程序失败。 |
| `404` | 请求路径不存在。 |
| `429` | 已有另一个扩图任务在执行。当前服务默认一次只处理一个任务。 |
| `200` | 扩图成功；健康检查和模型列表也会返回 `200`。 |

请求方应先检查 HTTP 状态码，再决定按 JSON 还是图片读取响应体。

## 8. 模型选择说明

下面的用途说明对应当前项目内置模型。对接时应使用“模型 ID”，而不是界面显示名称。

| 模型 ID | 界面名称 | 适用场景 | 选择建议 |
| --- | --- | --- | --- |
| `upscayl-standard-4x` | Upscayl 标准 | 适用于大多数图像，整体效果均衡。 | 不确定选哪个模型时的默认选择；适合风景、建筑、日常照片。 |
| `upscayl-lite-4x` | Upscayl 轻量版 | 适用于大多数图像，速度较快，质量损失较小。 | 更关注速度、批量吞吐量或设备性能有限时使用。 |
| `high-fidelity-4x` | 高保真 | 适用于各种图像，注重还原真实细节和平滑纹理。 | 适合建筑、产品、城市、夜景等希望细节自然的照片。 |
| `remacri-4x` | Remacri（非商业用途） | 适用于自然图像，强调锐度和细节。仅限非商业用途。 | 适合自然风景、人物、动物等希望画面更锐利的图片；商业项目不要选用。 |
| `ultramix-balanced-4x` | Ultramix（非商业用途） | 适用于自然图像，在锐度和细节之间取得平衡。仅限非商业用途。 | 当 Standard 过于保守、Ultrasharp 又过于锐利时使用；商业项目不要选用。 |
| `ultrasharp-4x` | Ultrasharp（非商业用途） | 适用于自然图像，重点增强锐度。仅限非商业用途。 | 适合边缘和纹理清晰度优先的照片；可能放大噪点或产生过锐效果，商业项目不要选用。 |
| `digital-art-4x` | 数字艺术 | 适用于数字艺术、插画、动漫和清晰线稿。 | 适合插画、卡通、游戏素材、线稿；不建议用于普通摄影。 |

### 快速选型

- 通用照片：`upscayl-standard-4x`
- 追求速度或批量处理：`upscayl-lite-4x`
- 追求自然、真实、平滑的照片细节：`high-fidelity-4x`
- 自然照片且希望更锐利：`remacri-4x`、`ultramix-balanced-4x` 或 `ultrasharp-4x`（非商业用途）
- 插画、动漫、数字绘画：`digital-art-4x`

模型效果会受到原图分辨率、压缩噪声、模糊程度和目标尺寸影响。扩图模型主要用于放大和重建细节，不能保证修复严重失焦、运动模糊或原图完全缺失的内容。

## 9. 部署注意事项

### Node.js

项目在 `package.json` 中指定了 Volta Node 版本 `18.20.5`。建议使用 Node 18 LTS 或其他兼容的 LTS 版本运行 API。

### 平台文件

服务根据运行平台自动选择对应的底层程序：

| 平台 | 执行文件 |
| --- | --- |
| macOS | `resources/mac/bin/upscayl-bin` |
| Linux | `resources/linux/bin/upscayl-bin` |
| Windows | `resources/win/bin/upscayl-bin.exe` |

部署时必须保留对应平台的执行文件和 `resources/models` 目录。Linux/Windows 环境还需要确认底层程序依赖的 GPU、Vulkan 驱动和系统库。

### 并发

当前实现使用单任务锁，同一时刻只允许一个扩图任务执行。第二个并发请求会立即收到 `429`。如果需要高并发，建议增加任务队列、Job ID、状态查询和独立 worker，而不是简单移除限制。

### 安全

当前服务适合作为内网或受信任环境中的基础服务，尚未内置 API Key、请求签名、持久化任务记录或速率限制。对公网开放前，建议至少增加反向代理鉴权、HTTPS、请求大小限制、访问日志和 IP 限流。
