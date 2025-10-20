# GPT Car MCP Server

This project exposes a tiny Model Context Protocol (MCP) server that controls a four-pin GPIO motor driver. The server registers a single `drive` tool that ChatGPT (or any MCP‑aware client) can call to move the car forward, backward, left, right, or stop.

## Key Features

- **MCP SDK integration** – built on top of `@modelcontextprotocol/sdk` and the Streamable HTTP transport.
- **Simple motor control** – wraps GPIO via `onoff`, with a noop fallback for development.
- **Public tunneling** – optionally opens an `ngrok` tunnel to reach the MCP endpoint from the internet.
- **TypeScript codebase** – strongly typed server, controller, and GPIO helpers.

## Project Structure

```
src/
  gpio.ts            // GPIO abstraction with onoff + noop fallback
  motorController.ts // Motor controller logic (duration limits, validation)
  mcpServer.ts       // MCP server setup, tool registration, tunnel bootstrap
dist/                // Compiled JavaScript output
```

## Prerequisites

- Node.js **18.x** (see `.nvmrc` for the recommended version).
- npm 9 or higher.
- Optional: Raspberry Pi or similar hardware with accessible GPIO pins.

## Installation

```bash
nvm use 18.20.3        # or install via nvm install 18.20.3
npm install
```

## Running the Server

```bash
npm start
```

The command compiles TypeScript and launches the MCP server on port `8001` (configurable via `PORT`). When an ngrok token is provided, you should see output similar to:

```
MCP server listening on http://0.0.0.0:8001/mcp
Public URL: https://<random>.ngrok.io
```

To enable tunneling, provide an ngrok auth token via `GPT_CAR_NGROK_TOKEN` (or `NGROK_AUTHTOKEN`). Region, subdomain, and custom domain can be set with the additional environment variables listed below. If no token is supplied, the server skips tunnel creation and logs a reminder.

## Manifest Endpoints

- `/.well-known/mcp/manifest.json`
- `/.well-known/manifest.json`

Both routes return the server manifest so clients like ChatGPT can auto-discover the `drive` tool.

## Environmental Options

| Variable                     | Description                                      |
|-----------------------------|--------------------------------------------------|
| `PORT`                      | HTTP port (default `8001`)                       |
| `HOST`                      | Bind host (default `0.0.0.0`)                    |
| `GPT_CAR_DISABLE_TUNNEL`    | Set to `1` to disable ngrok entirely              |
| `GPT_CAR_NGROK_TOKEN`       | ngrok auth token (alias of `NGROK_AUTHTOKEN`)     |
| `NGROK_AUTHTOKEN`           | Standard ngrok auth token environment variable    |
| `GPT_CAR_NGROK_REGION`      | Optional ngrok region (e.g., `us`, `eu`)          |
| `GPT_CAR_NGROK_SUBDOMAIN`   | Request a specific ngrok subdomain (paid plans)   |
| `GPT_CAR_NGROK_DOMAIN`      | Request a custom domain/hostname (paid plans)     |

## Development Tips

- Run `npm run dev` to execute the TypeScript server directly via `ts-node --esm`.
- The GPIO layer falls back to a noop implementation when `onoff` is unavailable, enabling local development without hardware.

## MCP Client Integration

1. Start the server.
2. Note the manifest URL (public or local).
3. Add a connector in ChatGPT (or your MCP client) pointing to that manifest.
4. Call the `drive` tool with arguments such as:

```json
{
  "name": "drive",
  "arguments": { "cmd": "FORWARD", "duration": 1.5 }
}
```

## Troubleshooting

- Ensure Node 18.x is active; other versions may not satisfy `onoff`.
- If tunneling fails, set `GPT_CAR_DISABLE_TUNNEL=1` or verify your network permits outgoing WebSocket connections.
- When running on a Raspberry Pi, confirm the process has permission to access GPIO (often requires root or membership in the `gpio` group).

## License

MIT
