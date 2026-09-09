# enhance HTTP API 对接文档

Windows 重启后的启动步骤参阅：[Startup-Windows.md](./Startup-Windows.md)。

## 1. 基本信息

| 项目 | 外部设备 | 本机 |
| --- | --- | --- |
| API Base URL | `https://enhance.yijian.dpdns.org` | `http://127.0.0.1:3000` |
| Web 页面 | `https://enhance.yijian.dpdns.org` | `http://127.0.0.1:5173` |
| 认证 | 无 | 无 |
| 图片上传 | 原始二进制请求体 | 原始二进制请求体 |

外部设备不能使用 `127.0.0.1`，因为它代表发起请求的设备自身。所有接口均返回 UTF-8，API 允许跨域请求。

## 2. 图片上传协议

`POST /api/jobs` 使用 raw binary body（原始二进制请求体）：

- 不是 `multipart/form-data`
- 不是 JSON
- 不是 Base64
- 不需要 `file`、`image` 等字段名
- 请求体直接放完整图片文件字节
- 单个文件最大 50 MB

| 请求部分 | 参数名 | 类型 | 是否必传 | 默认值 | 参数解析 |
| --- | --- | --- | --- | --- | --- |
| URL Query | `model` | string | 否 | `enhance-standard-4x` | 必须是 `/api/models` 返回的模型 ID |
| URL Query | `scale` | string | 否 | `4` | 只接受 `2`、`3`、`4` |
| URL Query | `format` | string | 否 | `png` | 只接受 `png`、`jpg`、`webp`；`jpeg` 转为 `jpg` |
| URL Query | `tileSize` | integer | 否 | `0` | 非负整数；0 为自动 |
| URL Query | `compression` | integer | 否 | `0` | 非负整数 |
| URL Query | `gpuId` | string | 否 | 空字符串 | GPU ID；空值表示自动 |
| URL Query | `tta` | string | 否 | `false` | 仅值为 `true` 时启用 |
| Header | `Content-Type` | MIME string | 是 | 无 | `image/png`、`image/jpeg` 或 `image/webp` |
| Header | `X-File-Name` | string | 否 | 按 MIME 推断 | 原始文件名；路径分隔符替换为 `_`，最多 255 字符 |
| Body | 图片内容 | binary | 是 | 无 | 直接发送图片字节，不能为空 |

## 3. `GET /health` 健康检查

请求：

```http
GET https://enhance.yijian.dpdns.org/health
```

无 Query、Header 或 Body 参数。成功返回 HTTP `200`：

| JSON 路径 | 类型 | 是否必有 | 默认/空值 | 参数解析 |
| --- | --- | --- | --- | --- |
| `status` | string | 是 | `ok` | 服务正常时固定为 `ok` |
| `queueDepth` | integer | 是 | `0` | 当前排队任务数 |
| `running` | integer | 是 | `0` | 当前处理任务数 |
| `concurrency` | integer | 是 | `1` | 最大并发处理数 |
| `capacity` | integer | 是 | `100` | 最大任务容量 |

## 4. `GET /api/models` 查询模型

请求：

```http
GET https://enhance.yijian.dpdns.org/api/models
```

无参数。响应：`{ "models": ["enhance-standard-4x", "enhance-lite-4x", "high-fidelity-4x", "remacri-4x", "ultramix-balanced-4x", "ultrasharp-4x", "digital-art-4x"] }`。

| JSON 路径 | 类型 | 是否必有 | 默认/空值 | 参数解析 |
| --- | --- | --- | --- | --- |
| `models` | string[] | 是 | `[]` | 可用于提交接口 `model` 参数的模型 ID |

## 5. `POST /api/jobs` 提交图片任务

外部 URL：

```text
POST https://enhance.yijian.dpdns.org/api/jobs
```

本机 URL：

```text
POST http://127.0.0.1:3000/api/jobs
```

Query、Header、Body 参数见第 2 节。示例：

```bash
curl -X POST \
  "https://enhance.yijian.dpdns.org/api/jobs?model=enhance-standard-4x&scale=4&format=png" \
  -H "Content-Type: image/png" \
  -H "X-File-Name: input.png" \
  --data-binary "@input.png"
```

成功返回 HTTP `202`，格式为 `{ "job": { ... } }`。

| JSON 路径 | 类型 | 是否必有 | 默认/空值 | 参数解析 |
| --- | --- | --- | --- | --- |
| `job` | object | 是 | 无 | 任务对象 |
| `job.id` | string | 是 | 无 | 唯一任务 ID，后续使用 |
| `job.status` | string | 是 | `queued` | `queued`、`running`、`succeeded`、`failed`、`canceled` |
| `job.stage` | string | 是 | `queued` | `queued`、`upscaling`、`encoding`、`completed`、`failed`、`canceled` |
| `job.progress` | integer | 是 | `0` | 0-100，阶段进度，不保证逐帧精确 |
| `job.position` | integer/null | 是 | `null` | 排队序号；非排队状态为 null |
| `job.createdAt` | ISO 8601 string | 是 | 无 | 创建时间 |
| `job.startedAt` | ISO 8601 string/null | 是 | `null` | 开始时间 |
| `job.finishedAt` | ISO 8601 string/null | 是 | `null` | 结束时间 |
| `job.config` | object | 是 | 无 | 服务端解析后的配置 |
| `job.config.model` | string | 是 | `enhance-standard-4x` | 实际模型 |
| `job.config.scale` | string | 是 | `4` | 实际倍率 |
| `job.config.format` | string | 是 | `png` | 实际输出格式 |
| `job.config.tileSize` | integer | 是 | `0` | Tile 大小 |
| `job.config.compression` | integer | 是 | `0` | 压缩参数 |
| `job.config.gpuId` | string | 是 | `""` | GPU ID |
| `job.config.tta` | boolean | 是 | `false` | 是否启用 TTA |
| `job.input` | object | 是 | 无 | 输入文件信息 |
| `job.input.filename` | string | 是 | 按 MIME 推断 | 输入文件名 |
| `job.input.size` | integer | 是 | 无 | 输入字节数 |
| `job.input.mime` | string | 是 | 无 | 输入 MIME |
| `job.output` | object/null | 是 | `null` | 成功后包含输出信息 |
| `job.error` | object/null | 是 | `null` | 失败时包含错误信息 |

## 6. `GET /api/jobs/{jobId}` 查询任务

| 参数名 | 位置 | 类型 | 是否必传 | 默认值 | 参数解析 |
| --- | --- | --- | --- | --- | --- |
| `jobId` | Path | string | 是 | 无 | 提交接口返回的 `job.id` |

```http
GET https://enhance.yijian.dpdns.org/api/jobs/{jobId}
```

无 Query、Header 或 Body 参数。成功返回 HTTP `200` 和 `{ "job": ... }`，字段与第 5 节相同。

## 7. `GET /api/jobs/{jobId}/events` SSE 实时进度

### 请求参数

| 参数名 | 位置 | 类型 | 是否必传 | 默认值 | 参数解析 |
| --- | --- | --- | --- | --- | --- |
| `jobId` | Path | string | 是 | 无 | 任务 ID |
| `Accept` | Header | string | 否 | 客户端默认 | 建议 `text/event-stream` |
| Query | URL | - | 否 | 无 | 此接口没有 Query 参数 |
| Body | 请求体 | - | 否 | 无 | 此接口没有请求体 |

请求：

```http
GET https://enhance.yijian.dpdns.org/api/jobs/{jobId}/events
Accept: text/event-stream
Cache-Control: no-cache
```

响应头：`Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`。

事件格式：

```text
event: job
data: {"job":{"id":"7a7b...","status":"running","stage":"upscaling","progress":10}}

```

| SSE 内容 | 类型 | 是否必有 | 默认/空值 | 参数解析 |
| --- | --- | --- | --- | --- |
| `event` | string | 是 | `job` | 固定事件名 |
| `data` | JSON string | 是 | 无 | 对 `data:` 内容执行 `JSON.parse` |
| `data.job` | object | 是 | 无 | 与任务查询接口的 `job` 相同 |
| `: heartbeat` | 注释行 | 否 | 每 15 秒 | 连接保活，客户端忽略 |

服务端连接建立时立即发送当前快照；状态变化时发送新快照；任务进入 `succeeded`、`failed`、`canceled` 后发送最终快照并关闭连接。

### SSE 对接流程

1. `POST /api/jobs` 上传图片，保存返回的 `job.id`。
2. `GET /api/jobs/{jobId}/events` 建立 SSE 长连接。
3. 只处理 `event: job`，解析 `data` JSON。
4. 用 `data.job.status`、`data.job.stage`、`data.job.progress` 更新进度。
5. 收到 `succeeded` 后调用 `/result`；收到 `failed` 读取 `job.error`；收到 `canceled` 结束流程。
6. SSE 断线后重新连接；也可以改用 `/api/jobs/{jobId}` 每 2 秒轮询。

## 8. `GET /api/jobs/{jobId}/result` 下载结果

| 参数名 | 位置 | 类型 | 是否必传 | 默认值 | 参数解析 |
| --- | --- | --- | --- | --- | --- |
| `jobId` | Path | string | 是 | 无 | 任务 ID |

```http
GET https://enhance.yijian.dpdns.org/api/jobs/{jobId}/result
```

仅任务 `status=succeeded` 时调用。成功 HTTP `200`，返回图片二进制：

| 响应部分 | 类型 | 是否必有 | 参数解析 |
| --- | --- | --- | --- |
| `Content-Type` | MIME string | 是 | 输出图片 MIME |
| `Content-Length` | integer string | 是 | 输出字节数 |
| `Content-Disposition` | string | 是 | 建议下载文件名 |
| Body | binary | 是 | 输出图片原始字节 |

结果默认保留 30 分钟。

## 9. `DELETE /api/jobs/{jobId}` 取消任务

| 参数名 | 位置 | 类型 | 是否必传 | 默认值 | 参数解析 |
| --- | --- | --- | --- | --- | --- |
| `jobId` | Path | string | 是 | 无 | 任务 ID |

```http
DELETE https://enhance.yijian.dpdns.org/api/jobs/{jobId}
```

排队或运行中返回 HTTP `202`，已结束任务返回 HTTP `200`，响应均为 `{ "job": ... }`。取消成功后 `job.status=canceled`。

## 10. `GET /api/system/resources` 系统资源

```http
GET https://enhance.yijian.dpdns.org/api/system/resources
```

无参数。核心字段：

| JSON 路径 | 类型 | 是否必有 | 参数解析 |
| --- | --- | --- | --- |
| `timestamp` | ISO 8601 string | 是 | 采集时间 |
| `platform` | string | 是 | 服务器操作系统 |
| `arch` | string | 是 | CPU 架构 |
| `uptimeSeconds` | number | 是 | 系统运行秒数 |
| `activeJob` | boolean | 是 | 是否正在处理任务 |
| `memory` | object | 是 | 内存统计 |
| `cpu` | object | 是 | CPU 统计 |
| `disk` | object | 是 | 磁盘统计 |
| `gpu` | object | 是 | GPU/Vulkan/显存统计 |
| `process` | object | 是 | API 进程统计 |
| `queueDepth` | integer | 是 | 当前排队数 |
| `running` | integer | 是 | 当前运行数 |
| `concurrency` | integer | 是 | 最大并发数 |

## 11. 错误响应

除结果下载接口外，错误通常返回：

```json
{
  "error": {
    "code": "UNSUPPORTED_MEDIA_TYPE",
    "message": "Only PNG, JPEG, and WEBP images are supported",
    "retryable": false
  }
}
```

| 字段 | 类型 | 是否必有 | 参数解析 |
| --- | --- | --- | --- |
| `error` | object | 是 | 错误对象 |
| `error.code` | string | 是 | 程序错误码 |
| `error.message` | string | 是 | 可读错误信息 |
| `error.retryable` | boolean | 是 | 是否可以重试 |

| HTTP 状态码 | 错误码/含义 |
| --- | --- |
| `400` | 请求错误 |
| `404` | 接口或任务不存在 |
| `409` | 结果未就绪 |
| `410` | 结果已过期 |
| `413` | 图片超过 50 MB |
| `415` | 图片类型不支持 |
| `422` | 模型或参数错误 |
| `429` | 队列已满 |
| `503` | 服务正在关闭 |
| `530` | Cloudflare Tunnel 未连接 |

## 12. 升图对接方式一：轮询（Polling）

轮询方式适用于后端服务、脚本、移动端，或不支持 SSE 的客户端。客户端通过任务状态接口主动查询处理进度。

### 12.1 完整调用顺序

```text
1. （可选）GET /api/models，选择 model
2. POST /api/jobs，上传原始图片，取得 job.id
3. 等待 2 秒
4. GET /api/jobs/{jobId} 查询状态
5. status=queued 或 running：继续每 2 秒查询
6. status=succeeded：GET /api/jobs/{jobId}/result 下载结果
7. status=failed：读取 job.error，处理失败
8. status=canceled：任务已取消，不下载结果
```

### 12.2 curl 完整示例

第一步，上传图片：

```bash
curl -s -X POST \
  "https://enhance.yijian.dpdns.org/api/jobs?model=enhance-standard-4x&scale=4&format=png" \
  -H "Content-Type: image/png" \
  -H "X-File-Name: input.png" \
  --data-binary "@input.png" > submit.json
```

从返回 JSON 中取得：

```text
job.id = 7a7b2d3e-...
```

第二步，查询任务：

```bash
curl "https://enhance.yijian.dpdns.org/api/jobs/7a7b2d3e-..."
```

第三步，根据 `job.status` 判断：

```json
{ "job": { "status": "running", "stage": "upscaling", "progress": 10 } }
```

当状态为 `queued` 或 `running` 时，等待约 2 秒后再次调用同一个 URL。当状态为 `succeeded` 时：

```bash
curl -L \
  "https://enhance.yijian.dpdns.org/api/jobs/7a7b2d3e-.../result" \
  -o output-upscaled.png
```

### 12.3 JavaScript 轮询示例

```js
const API = "https://enhance.yijian.dpdns.org";
const file = document.querySelector("input[type=file]").files[0];

// 1. 上传原始图片二进制
const submitResponse = await fetch(
  `${API}/api/jobs?model=enhance-standard-4x&scale=4&format=png`,
  {
    method: "POST",
    headers: { "Content-Type": file.type, "X-File-Name": file.name },
    body: file,
  },
);
if (!submitResponse.ok) throw new Error(await submitResponse.text());
const { job: submittedJob } = await submitResponse.json();

// 2. 每 2 秒查询任务状态
let job;
while (true) {
  const statusResponse = await fetch(`${API}/api/jobs/${submittedJob.id}`);
  if (!statusResponse.ok) throw new Error(await statusResponse.text());
  job = (await statusResponse.json()).job;
  console.log(job.status, job.stage, job.progress);
  if (["succeeded", "failed", "canceled"].includes(job.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

// 3. 只有 succeeded 才下载
if (job.status !== "succeeded") {
  throw new Error(job.error?.message || `任务状态：${job.status}`);
}
const resultResponse = await fetch(`${API}/api/jobs/${submittedJob.id}/result`);
if (!resultResponse.ok) throw new Error(await resultResponse.text());
const blob = await resultResponse.blob();
const link = document.createElement("a");
link.href = URL.createObjectURL(blob);
link.download = job.output?.filename || "output-upscaled.png";
link.click();
```

## 13. 升图对接方式二：SSE（Server-Sent Events）

SSE 方式适用于浏览器和支持 HTTP 长连接的客户端。上传接口仍然是 `POST /api/jobs`，只有“获取进度”的方式改为 SSE。

### 13.1 完整调用顺序

```text
1. （可选）GET /api/models，选择 model
2. POST /api/jobs，上传原始图片，取得 job.id
3. GET /api/jobs/{jobId}/events，建立 SSE 长连接
4. 接收 event=job 的 data，解析 data.job
5. status=queued/running：更新进度，保持连接
6. status=succeeded：关闭 SSE，GET /api/jobs/{jobId}/result 下载结果
7. status=failed：关闭 SSE，读取 job.error
8. status=canceled：关闭 SSE，结束流程
```

### 13.2 SSE 请求

```http
GET https://enhance.yijian.dpdns.org/api/jobs/{jobId}/events
Accept: text/event-stream
Cache-Control: no-cache
```

SSE 没有请求体，也没有 Query 参数。服务端会立即发送当前任务快照，之后在任务状态变化时发送新事件。

### 13.3 SSE 事件格式

```text
event: job
data: {"job":{"id":"7a7b2d3e-...","status":"running","stage":"upscaling","progress":10}}

```

客户端处理规则：

| 收到的状态 | 客户端动作 |
| --- | --- |
| `queued` | 显示排队状态，保持 SSE 连接 |
| `running` | 显示 `stage` 和 `progress`，保持 SSE 连接 |
| `succeeded` | 关闭 SSE，调用 `/result` 下载 |
| `failed` | 关闭 SSE，读取 `job.error` |
| `canceled` | 关闭 SSE，结束流程 |
| `: heartbeat` | 忽略，这是连接保活注释 |

### 13.4 JavaScript SSE 完整示例

```js
const API = "https://enhance.yijian.dpdns.org";
const file = document.querySelector("input[type=file]").files[0];

// 1. 上传原始图片二进制
const submitResponse = await fetch(
  `${API}/api/jobs?model=enhance-standard-4x&scale=4&format=png`,
  {
    method: "POST",
    headers: { "Content-Type": file.type, "X-File-Name": file.name },
    body: file,
  },
);
if (!submitResponse.ok) throw new Error(await submitResponse.text());
const { job: submittedJob } = await submitResponse.json();
const jobId = submittedJob.id;

// 2. 建立 SSE，等待任务终态
const finalJob = await new Promise((resolve, reject) => {
  const source = new EventSource(`${API}/api/jobs/${jobId}/events`);
  source.addEventListener("job", (event) => {
    const job = JSON.parse(event.data).job;
    console.log(job.status, job.stage, job.progress);
    if (job.status === "succeeded") {
      source.close();
      resolve(job);
    } else if (["failed", "canceled"].includes(job.status)) {
      source.close();
      reject(new Error(job.error?.message || job.status));
    }
  });
  source.onerror = () => {
    source.close();
    reject(new Error("SSE 连接断开"));
  };
});

// 3. 下载输出图片二进制
const resultResponse = await fetch(`${API}/api/jobs/${finalJob.id}/result`);
if (!resultResponse.ok) throw new Error(await resultResponse.text());
const blob = await resultResponse.blob();
const link = document.createElement("a");
link.href = URL.createObjectURL(blob);
link.download = finalJob.output?.filename || "output-upscaled.png";
link.click();
```

### 13.5 SSE 断线处理

SSE 客户端必须保存 `jobId`。如果连接断开，按以下顺序处理：

```text
1. 关闭旧 EventSource
2. 重新 GET /api/jobs/{jobId}/events
3. 如果重连失败，改用 GET /api/jobs/{jobId} 每 2 秒轮询
4. status=succeeded 后下载 /result
5. status=failed/canceled 后结束流程
```

重新连接 SSE 时，服务端会立即发送当前快照，即使任务已经完成也不会丢失最终状态。

## 14. 两种方式对比

| 对接方式 | 进度接口 | 优点 | 客户端要求 |
| --- | --- | --- | --- |
| 方式一：轮询 | `GET /api/jobs/{jobId}` | 实现简单、适用于任何客户端 | 客户端定时发请求，建议间隔 2 秒 |
| 方式二：SSE | `GET /api/jobs/{jobId}/events` | 实时推送、减少重复请求 | 支持 SSE 长连接；断线需要重连或轮询兜底 |

两种方式的上传和下载接口完全相同：

```text
POST /api/jobs
  -> 取得 job.id
  -> 方式一：轮询 /api/jobs/{jobId}
     或
  -> 方式二：监听 /api/jobs/{jobId}/events
  -> status=succeeded
  -> GET /api/jobs/{jobId}/result
```
