# Upscayl Web 工作台

这是一个不依赖构建工具的静态网页，用于调用项目中的 Upscayl HTTP API。

## 启动

先在项目根目录启动 API：

```bash
npm run api
```

然后使用项目自带的 Node.js 静态服务器打开 `web/` 目录：

```bash
npm run web
```

也可以通过环境变量修改网页服务监听地址和端口：

```bash
WEB_HOST=0.0.0.0 WEB_PORT=8080 npm run web
```

浏览器访问：

```text
http://127.0.0.1:5173
```

页面默认请求 `http://127.0.0.1:3000`。如果 API 使用了其他地址或端口，可以在页面底部修改 `API endpoint`。

## 使用

1. 点击“检查 API 连接”，确认服务在线。
2. 拖入或选择 PNG、JPG/JPEG、WEBP 图片。
3. 选择模型、放大倍数和输出格式。
4. 点击“开始升图”。
5. 处理完成后在结果区域预览并下载图片。

图片会以原始二进制请求体发送到 `POST /api/upscale`，页面不会将图片上传到第三方服务。
