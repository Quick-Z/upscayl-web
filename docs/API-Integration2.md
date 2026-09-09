# Upscayl HTTP API 对接文档

## 1. 服务地址

外部设备（其他电脑、手机、服务器）使用：

```text
https://pscayl.yijian.dpdns.org
```

本机调用使用：

```text
http://127.0.0.1:3000
```

外部设备不要使用 `127.0.0.1`，因为它代表外部设备自身。

## 2. 上传协议总览

提交接口为 `POST /api/jobs`。图片采用 **raw binary body（原始二进制请求体）** 上传：

- 不是 `multipart/form-data`
- 不是 JSON
- 不是 Base64
- 请求体没有字段名，直接放图片文件字节
- 单个图片最大 50 MB

| 请求部分 | 参数名 | 类型 | 是否必传 | 默认值 | 参数解析 |
| --- | --- | --- | --- | --- | --- |
| URL | `model` | string | 否 | `upscayl-standard-4x` | 必须是 `/api/models` 返回的模型 ID |
| URL | `scale` | string | 否 | `4` | 只接受 `2`、`3`、`4` |
| URL | `format` | string | 否 | `png` | 只接受 `png`、`jpg`、`webp`；`jpeg` 会规范化为 `jpg` |
| URL | `tileSize` | integer | 否 | `0` | 非负整数；`0` 表示自动 |
| URL | `compression` | integer | 否 | `0` | 非负整数 |
| URL | `gpuId` | string | 否 | 空字符串 | GPU ID；空值表示自动选择 |
| URL | `tta` | string | 否 | `false` | 仅值为 `true` 时启用 TTA |
| Header | `Content-Type` | MIME string | 是 | 无 | 必须为 `image/png`、`image/jpeg` 或 `image/webp` |
| Header | `X-File-Name` | string | 否 | 根据 MIME 推断 | 原始文件名；路径分隔符会被替换为 `_` |
| Body | 图片内容 | binary | 是 | 无 | 直接发送完整图片二进制，不包裹 JSON 或表单 |

## 3. 提交图片任务

### 外部设备 URL

```http
POST https://pscayl.yijian.dpdns.org/api/jobs?model=upscayl-standard-4x&scale=4&format=png
```

### 本机 URL

```http
POST http://127.0.0.1:3000/api/jobs?model=upscayl-standard-4x&scale=4&format=png
```

### 请求示例

```http
POST /api/jobs?model=upscayl-standard-4x&scale=4&format=png HTTP/1.1
Host: pscayl.yijian.dpdns.org
Content-Type: image/png
X-File-Name: input.png

<input.png 的原始二进制内容>
```

### curl

```bash
curl -X POST \
  "https://pscayl.yijian.dpdns.org/api/jobs?model=upscayl-standard-4x&scale=4&format=png" \
  -H "Content-Type: image/png" \
  -H "X-File-Name: input.png" \
  --data-binary "@input.png"
```

### JavaScript fetch

```js
const file = document.querySelector("input[type=file]").files[0];
const response = await fetch(
  "https://pscayl.yijian.dpdns.org/api/jobs?model=upscayl-standard-4x&scale=4&format=png",
  {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": file.name,
    },
    body: file,
  },
);
const data = await response.json();
```

不要这样写：

```js
// 错误：接口不接收 multipart/form-data
const form = new FormData();
form.append("file", file);
fetch(url, { method: "POST", body: form });
```

## 4. 提交接口返回参数

成功状态码为 `202`，返回 `application/json`：

```json
{
  "job": {
    "id": "7a7b...",
    "status": "queued",
    "stage": "queued",
    "progress": 0,
    "position": 1,
    "createdAt": "2026-09-09T06:00:00.000Z",
    "startedAt": null,
    "finishedAt": null,
    "config": {},
    "input": {},
    "output": null,
    "error": null
  }
}
```

| JSON 路径 | 类型 | 是否必有 | 默认/空值 | 参数解析 |
| --- | --- | --- | --- | --- |
| `job` | object | 是 | 无 | 任务对象 |
| `job.id` | string | 是 | 无 | 唯一任务 ID，后续查询使用 |
| `job.status` | string | 是 | `queued` | `queued`、`running`、`succeeded`、`failed`、`canceled` |
| `job.stage` | string | 是 | `queued` | `queued`、`upscaling`、`encoding`、`completed`、`failed`、`canceled` |
| `job.progress` | integer | 是 | `0` | 0 到 100 的阶段进度，不保证逐帧精度 |
| `job.position` | integer/null | 是 | `null` | 排队序号；非排队状态为 `null` |
| `job.createdAt` | ISO 8601 string | 是 | 无 | 创建时间 |
| `job.startedAt` | ISO 8601 string/null | 是 | `null` | 开始处理时间 |
| `job.finishedAt` | ISO 8601 string/null | 是 | `null` | 结束时间 |
| `job.config` | object | 是 | 请求解析后的配置 | 实际采用的模型、倍率、格式等 |
| `job.input` | object | 是 | 无 | 输入文件信息 |
| `job.input.filename` | string | 是 | MIME 推断文件名 | 输入文件名 |
| `job.input.size` | integer | 是 | 无 | 输入字节数 |
| `job.input.mime` | string | 是 | 无 | 输入 MIME 类型 |
| `job.output` | object/null | 是 | `null` | 成功前为 `null` |
| `job.error` | object/null | 是 | `null` | 失败时包含错误信息 |

## 5. 查询任务状态

```http
GET https://pscayl.yijian.dpdns.org/api/jobs/{jobId}
```

返回参数与 `job` 对象相同。建议不支持 SSE 的客户端每 2 秒请求一次。

## 6. SSE 实时进度

```http
GET https://pscayl.yijian.dpdns.org/api/jobs/{jobId}/events
```

响应头为 `Content-Type: text/event-stream`。事件格式：

```text
event: job
data: {"job":{"id":"7a7b...","status":"running","progress":10}}
```

| SSE 字段 | 类型 | 是否必有 | 参数解析 |
| --- | --- | --- | --- |
| `event` | string | 是 | 固定为 `job` |
| `data` | JSON string | 是 | 解析后得到 `{ job: ... }` |
| `data.job` | object | 是 | 与任务状态接口的 `job` 相同 |

## 7. 下载结果

```http
GET https://pscayl.yijian.dpdns.org/api/jobs/{jobId}/result
```

仅当 `job.status=succeeded` 时调用。响应不是 JSON，而是图片二进制流。

| 响应头 | 类型 | 是否必有 | 参数解析 |
| --- | --- | --- | --- |
| `Content-Type` | MIME string | 是 | 输出图片 MIME |
| `Content-Length` | integer string | 是 | 输出字节数 |
| `Content-Disposition` | string | 是 | 包含建议下载文件名 |
| 响应体 | binary | 是 | 输出图片原始二进制 |

结果默认保留 30 分钟。

## 8. 其他接口

| 方法 | 外部 URL | 返回类型 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/health` | JSON object | 服务和队列健康状态 |
| `GET` | `/api/models` | JSON object | 可用模型 ID 列表 |
| `GET` | `/api/system/resources` | JSON object | 系统资源和队列信息 |
| `DELETE` | `/api/jobs/{jobId}` | JSON object | 取消排队或运行中的任务 |

完整外部 URL 以 `https://pscayl.yijian.dpdns.org` 为前缀。

## 9. 错误响应

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
| `error.message` | string | 是 | 人类可读的错误说明 |
| `error.retryable` | boolean | 是 | 是否可以稍后重试 |

常见 HTTP 状态码：`400` 请求错误、`413` 超过 50 MB、`415` 类型不支持、`422` 参数错误、`429` 队列已满、`404` 任务不存在、`409` 结果未就绪、`410` 结果已过期、`530` Cloudflare Tunnel 未连接。
