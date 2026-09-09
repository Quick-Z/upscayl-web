# Upscayl Web

Upscayl is now a Web-only image-upscaling project. The static browser client in
`web/` sends jobs to the local HTTP API in `server/`, which runs the bundled
Upscayl inference binary and models.

## Requirements

- Node.js 18.20.5 or newer
- A Vulkan-capable GPU supported by the bundled Upscayl binary

## Run locally

```sh
npm install
npm start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The browser application
uses `http://127.0.0.1:3000` for its API by default.

Set `API_HOST` / `API_PORT` to configure the API listener, or `WEB_HOST` /
`WEB_PORT` to configure the static Web server. See
[the API integration guide](docs/API-Integration.md) and
[the Web client guide](web/README.md) for endpoint and UI details.

## Scripts

- `npm run build`: TypeScript-compile the HTTP API.
- `npm start`: compile the API, then start the API and Web client together.
- `npm run clean`: remove generated API output.

## License

AGPL-3.0. See [LICENSE](LICENSE).
