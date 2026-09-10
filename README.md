# enhance Web

enhance is now a Web-only image-upscaling project. The static browser client in
`web/` sends jobs to the local HTTP API in `server/`, which runs the bundled
enhance inference binary and models.

## Requirements

- Node.js 18.20.5 or newer
- A Vulkan-capable GPU supported by the bundled enhance binary

## Run locally

```sh
npm install
npm start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The browser application
uses the current site origin for the API when accessed through a public
domain or reverse proxy. When accessing the built-in Web server directly on
port `5173`, it uses the same host on port `3000` for the API.

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
