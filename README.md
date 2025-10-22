# GPT Car MCP Server

This project exposes a tiny Model Context Protocol (MCP) server that controls a four-pin GPIO motor driver. The server registers a single `drive` tool that ChatGPT (or any MCP‑aware client) can call to move the car forward, backward, left, right, or stop.

## Key Features

- **MCP SDK integration** – built on top of `@modelcontextprotocol/sdk` and the Streamable HTTP transport.
- **Simple motor control** – wraps GPIO via `onoff`, with a noop fallback for development.
- **Public tunneling** – automatically opens an HTTPS tunnel (via LocalTunnel by default) so the MCP endpoint is reachable from the internet.
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

- Node.js **18.19.x** (or newer 18.x releases; see `.nvmrc` for the recommended version).
- npm 9 or higher.
- Optional: Raspberry Pi or similar hardware with accessible GPIO pins.

## Installation

```bash
nvm use 18.20.3        # or install via nvm install 18.20.3
npm install
# On Raspberry Pi, install pigpio for low-latency GPIO access (no package.json changes)
npm install pigpio --omit=dev --no-save
```

## Running the Server

```bash
npm start
```

The command compiles TypeScript and launches the MCP server on port `8001` (configurable via `PORT`). By default the server establishes a [LocalTunnel](https://github.com/localtunnel/localtunnel) HTTPS endpoint so remote MCP clients can connect immediately. Successful startup looks like:

```
MCP server listening on http://0.0.0.0:8001/mcp
Tunnel ready via localtunnel: https://<random>.loca.lt
Public URL (localtunnel): https://<random>.loca.lt
```

Set `GPT_CAR_DISABLE_TUNNEL=1` to opt out of tunneling (for fully offline installs). To switch to ngrok, export `GPT_CAR_TUNNEL_PROVIDER=ngrok` and provide an auth token via `GPT_CAR_NGROK_TOKEN` (or `NGROK_AUTHTOKEN`). Region, subdomain, and custom domain can be set with the additional environment variables listed below. If every provider fails, the server will continue running locally and print diagnostics so you can adjust the configuration.

## Manifest Endpoints

- `/.well-known/mcp/manifest.json`
- `/.well-known/manifest.json`

Both routes return the server manifest so clients like ChatGPT can auto-discover the `drive` tool.

## Environmental Options

| Variable                     | Description                                      |
|-----------------------------|--------------------------------------------------|
| `PORT`                      | HTTP port (default `8001`)                       |
| `HOST`                      | Bind host (default `0.0.0.0`)                    |
| `GPT_CAR_DISABLE_TUNNEL`    | Set to `1` to disable tunnel creation entirely     |
| `GPT_CAR_TUNNEL_PROVIDER`   | `localtunnel` (default) or `ngrok`                |
| `GPT_CAR_LOCALTUNNEL_SUBDOMAIN` / `GPT_CAR_LT_SUBDOMAIN` | Request a specific LocalTunnel subdomain (best effort) |
| `GPT_CAR_LOCALTUNNEL_HOST`  | Override the LocalTunnel service host             |
| `GPT_CAR_NGROK_TOKEN`       | ngrok auth token (alias of `NGROK_AUTHTOKEN`)     |
| `NGROK_AUTHTOKEN`           | Standard ngrok auth token environment variable    |
| `GPT_CAR_NGROK_REGION`      | Optional ngrok region (e.g., `us`, `eu`)          |
| `GPT_CAR_NGROK_SUBDOMAIN`   | Request a specific ngrok subdomain (paid plans)   |
| `GPT_CAR_NGROK_DOMAIN`      | Request a custom domain/hostname (paid plans)     |
| `GPT_CAR_PIN_FORWARD`       | Override the BCM pin used for forward motion      |
| `GPT_CAR_PIN_BACKWARD`      | Override the BCM pin used for backward motion     |
| `GPT_CAR_PIN_LEFT`          | Override the BCM pin used for left turns          |
| `GPT_CAR_PIN_RIGHT`         | Override the BCM pin used for right turns         |
| `GPT_CAR_DRIVE_DURATION`    | Default duration (seconds) for forward/backward   |
| `GPT_CAR_TURN_DURATION`     | Default duration (seconds) for left/right turns   |
| `GPT_CAR_MAX_DURATION`      | Maximum duration (seconds) allowed per command    |

The server automatically caps tool input validation to the configured `GPT_CAR_MAX_DURATION` value.

## Raspberry Pi Notes

- The server auto-detects the best available GPIO backend. If the optional [`pigpio`](https://www.npmjs.com/package/pigpio)
  module is installed, it is preferred for accurate timing on recent Raspberry Pi kernels that disable the legacy sysfs GPIO
  interface. When `pigpio` is missing, it falls back to [`onoff`](https://www.npmjs.com/package/onoff), and finally to a
  noop simulator when neither backend is available.
- Install the OS-level daemon if necessary: `sudo apt install pigpio`.
- Ensure the `pigpiod` daemon is running (`sudo systemctl enable --now pigpiod`) and that the process has permission to access
  GPIO (either run under `sudo` or add the user to the `gpio` group).
- To skip the optional ngrok binary on constrained devices, install with `npm install --omit=optional`.

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
- If tunneling fails, review the startup logs for provider-specific errors, adjust the environment variables above, or set `GPT_CAR_DISABLE_TUNNEL=1` to run the server locally.
- When running on a Raspberry Pi, confirm the process has permission to access GPIO (often requires root or membership in the `gpio` group).
- A startup warning such as `pigpio module not installed` means the high-performance backend was skipped; install it with
  `npm install pigpio --omit=dev --no-save` for better responsiveness.

## License

MIT
