# Upscayl 异步 HTTP API

服务端采用异步任务队列。图片提交后立即返回 `job.id`，不会等待 GPU 处理完成。

## 启动

```bash
npm run api
```

默认地址：`http://127.0.0.1:3000`。可通过 `API_HOST`、`API_PORT`、`API_MAX_QUEUE` 和 `API_CONCURRENCY` 配置监听地址、队列上限和并发槽。

## 提交任务

### `POST /api/jobs`

请求体直接发送图片二进制，不使用 JSON 或 multipart。请求头使用 `Content-Type: image/png`、`image/jpeg` 或 `image/webp`，可选 `X-File-Name` 指定原始文件名。

查询参数：`model`、`scale`（2/3/4）、`format`（png/jpg/webp）、`tileSize`、`compression`、`gpuId`、`tta=true`。

成功返回 `202`，包含 `job.id`、`status`、`position`、配置快照和输入文件信息。队列达到上限时返回 `429 QUEUE_FULL`。

## 查询、推送、下载和取消

- `GET /api/jobs/:id`：轮询任务状态。状态为 `queued`、`running`、`succeeded`、`failed`、`canceled`。
- `GET /api/jobs/:id/events`：SSE 实时事件，事件名为 `job`；连接建立时会先发送当前快照，断线后可重连。
- `GET /api/jobs/:id/result`：任务成功后的结果流式下载；未完成返回 `409`，过期返回 `410`。
- `DELETE /api/jobs/:id`：取消排队或运行中的任务。

处理中会返回 `stage`（`queued`、`upscaling`、`encoding`）和阶段级 `progress`。底层程序没有可靠的细粒度进度回调，因此百分比不是逐帧精度。

错误统一格式：

```json
{ "error": { "code": "QUEUE_FULL", "message": "The processing queue is full", "retryable": true } }
```

常见状态码：`400` 请求错误、`413` 文件超过 50 MB、`415` 类型不支持、`422` 参数错误、`429` 队列已满、`404` 任务不存在、`409` 结果未就绪、`410` 结果已过期。

## 其他接口

- `GET /health`：返回 `queueDepth`、`running`、`concurrency` 和 `capacity`。
- `GET /api/models`：返回可用模型列表。
- `GET /api/system/resources`：返回系统资源和队列信息。

旧的同步接口 `POST /api/upscale` 已删除，不再提供兼容路径。
