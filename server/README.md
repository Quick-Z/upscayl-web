# Upscayl HTTP API

完整的中文对接文档请参阅：[docs/API-Integration.md](../docs/API-Integration.md)。

Start the local API server with:

```bash
npm run api
```

The server listens on `127.0.0.1:3000` by default. Set `API_HOST` and `API_PORT` to change the bind address and port.

## Endpoints

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/models
```

Send the image as the raw request body. The result is returned as an image:

```bash
curl -X POST \
  'http://127.0.0.1:3000/api/upscale?model=upscayl-standard-4x&scale=4&format=png' \
  -H 'Content-Type: image/png' \
  --data-binary '@input.png' \
  --output output.png
```

Supported query parameters are `model`, `scale` (`2`, `3`, or `4`), `format` (`png`, `jpg`, or `webp`), `tileSize`, `compression`, `gpuId`, and `tta=true`.
