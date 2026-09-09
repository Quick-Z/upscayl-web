# Windows 重启后的完整启动流程

本项目当前由两个前台进程组成：

1. Upscayl 项目：提供 Web 页面和图片处理 API。
2. Cloudflare Tunnel：把公网域名转发到本机服务。

电脑重启后，这两个进程都需要重新启动。当前没有安装为 Windows 服务，因此关闭对应终端窗口后，进程也会停止，外部设备将无法访问。

## 1. 启动前检查

确认已安装：

```text
Node.js
npm
cloudflared
```

项目目录：

```text
D:\upscayl-web
```

Cloudflare 配置文件：

```text
C:\Users\Admin\.cloudflared\config.yml
```

公网地址：

```text
https://pscayl.yijian.dpdns.org
```

## 2. 启动 Upscayl 项目

打开第一个 PowerShell 或 CMD 窗口，执行：

```powershell
cd D:\upscayl-web
npm run dev
```

看到类似以下输出，表示项目服务已启动：

```text
Upscayl API listening on http://127.0.0.1:3000
Upscayl web UI listening on http://127.0.0.1:5173
```

本机验证：

```powershell
Invoke-WebRequest http://127.0.0.1:5173 -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:3000/health
```

预期结果：网页返回 HTTP `200`，健康检查返回包含 `"status": "ok"` 的 JSON。

这个窗口必须保持运行。不要关闭，也不要按 `Ctrl+C`。

## 3. 启动 Cloudflare Tunnel

保持第一个窗口运行，再打开第二个 PowerShell 窗口，执行：

```powershell
cloudflared tunnel --protocol http2 --edge-ip-version 4 `
  --config C:\Users\Admin\.cloudflared\config.yml `
  run 456bf58f-5985-450e-ae77-cb225527c341
```

看到以下日志，表示隧道已连接：

```text
Registered tunnel connection
```

这个窗口也必须保持运行。不要关闭，也不要按 `Ctrl+C`。

当前 `config.yml` 已配置：

| 路径 | 转发目标 | 用途 |
| --- | --- | --- |
| `/api/*` | `http://127.0.0.1:3000` | API 接口 |
| `/health` | `http://127.0.0.1:3000` | 健康检查 |
| 其他路径 | `http://127.0.0.1:5173` | Web 页面 |

这里的 `127.0.0.1` 是 cloudflared 所在服务器本机地址，外部设备不需要也不能填写这个地址。

## 4. 验证公网访问

在本机或其他设备上打开：

```text
https://pscayl.yijian.dpdns.org
```

先验证健康检查：

```powershell
Invoke-RestMethod https://pscayl.yijian.dpdns.org/health
```

也可以在 CMD 中使用：

```bat
curl https://pscayl.yijian.dpdns.org/health
```

预期返回：

```json
{
  "status": "ok",
  "queueDepth": 0,
  "running": 0,
  "concurrency": 1,
  "capacity": 100
}
```

## 5. 外部设备使用 Web 工作台

外部电脑或手机只打开：

```text
https://pscayl.yijian.dpdns.org
```

页面的 API endpoint 应为：

```text
https://pscayl.yijian.dpdns.org
```

当前版本会自动使用浏览器当前访问的域名。外部设备不要填写：

```text
http://127.0.0.1:3000
```

因为外部设备上的 `127.0.0.1` 指向它自己。

## 6. 每次重启后的最短流程

```powershell
# 窗口 1
cd D:\upscayl-web
npm run dev

# 窗口 2
cloudflared tunnel --protocol http2 --edge-ip-version 4 `
  --config C:\Users\Admin\.cloudflared\config.yml `
  run 456bf58f-5985-450e-ae77-cb225527c341
```

然后访问：

```text
https://pscayl.yijian.dpdns.org
```

## 7. 常见问题

### 页面返回 Cloudflare 530

通常是 cloudflared 没有运行、隧道连接失败，或运行隧道的窗口被关闭。重新执行第 3 节命令，并确认日志出现 `Registered tunnel connection`。

### 页面可以打开，但 API 检查失败

检查页面中的 API endpoint 是否为：

```text
https://pscayl.yijian.dpdns.org
```

不要使用外部设备自己的 `127.0.0.1:3000`。

### 本机也打不开

检查第一个终端是否仍显示：

```text
Upscayl API listening on http://127.0.0.1:3000
Upscayl web UI listening on http://127.0.0.1:5173
```

如果没有，重新运行：

```powershell
cd D:\upscayl-web
npm run dev
```

### cloudflared 报 7844 端口错误

当前启动参数已使用 IPv4 和 HTTP/2。若仍报错，说明网络或防火墙阻止访问 Cloudflare 的 TCP `7844` 端口，需要更换网络或放行该端口。

## 8. 停止服务

在对应终端按 `Ctrl+C`：

1. 先停止 cloudflared 窗口。
2. 再停止 `npm run dev` 窗口。

停止后公网地址将不可用，这是正常现象。

## 9. 可选：设置为开机自动启动

如果不想每次重启后手动打开两个终端，可以使用 Windows“任务计划程序”创建两个登录时运行的任务：

| 任务 | 程序 | 工作目录 |
| --- | --- | --- |
| Upscayl | `npm.cmd run dev` | `D:\upscayl-web` |
| Cloudflare Tunnel | `C:\Program Files (x86)\cloudflared\cloudflared.exe` | 任意 |

Cloudflare Tunnel 任务的参数：

```text
tunnel --protocol http2 --edge-ip-version 4 --config C:\Users\Admin\.cloudflared\config.yml run 456bf58f-5985-450e-ae77-cb225527c341
```

建议先按前面的手动流程确认服务正常，再配置自动启动。自动启动后仍可通过 `/health` 和公网网页验证状态。
