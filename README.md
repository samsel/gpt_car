# GPT Car MCP Server

This project exposes a tiny Model Context Protocol (MCP) server that controls a four-pin GPIO motor driver. The server registers a single `drive` tool that ChatGPT (or any MCP-aware client) can call to move the car forward, backward, left, right, or stop.

## Key Points

- **Zero build step** – plain JavaScript files run directly with Node.js.
- **Minimal dependencies** – only relies on `@modelcontextprotocol/sdk` plus the optional `pigpio` GPIO helper.
- **Raspberry Pi friendly** – avoids heavy native extensions and falls back to a noop GPIO driver when hardware access is unavailable.

## Project Structure

```
src/
  gpio.js            // GPIO abstraction with pigpio + noop fallback
  motorController.js // Motor controller logic (duration limits, validation)
  mcpServer.js       // MCP server setup and tool registration
```

## Prerequisites

- Node.js **18.x** (lightweight enough for Raspberry Pi OS Bookworm).
- npm 9 or newer.
- Optional: Raspberry Pi or similar hardware with accessible GPIO pins.

## Installation

```bash
npm install
# On Raspberry Pi, install pigpio for low-latency GPIO access (optional)
npm install pigpio --omit=dev --no-save
```

## Running the Server

```bash
npm start
```

The server listens on port `8001` (configurable via the `PORT` variable). Visit `http://<host>:<port>/.well-known/mcp/manifest.json` to retrieve the manifest, or point your MCP client directly at the `/mcp` endpoint.

## Environment Variables

| Variable                  | Description                                      |
|--------------------------|--------------------------------------------------|
| `PORT`                   | HTTP port (default `8001`)                       |
| `HOST`                   | Bind host (default `0.0.0.0`)                    |
| `GPT_CAR_PIN_FORWARD`    | Override the BCM pin used for forward motion     |
| `GPT_CAR_PIN_BACKWARD`   | Override the BCM pin used for backward motion    |
| `GPT_CAR_PIN_LEFT`       | Override the BCM pin used for left turns         |
| `GPT_CAR_PIN_RIGHT`      | Override the BCM pin used for right turns        |
| `GPT_CAR_DRIVE_DURATION` | Default duration (seconds) for forward/backward  |
| `GPT_CAR_TURN_DURATION`  | Default duration (seconds) for left/right turns  |
| `GPT_CAR_MAX_DURATION`   | Maximum duration (seconds) allowed per command   |

The server automatically caps tool input validation to the configured `GPT_CAR_MAX_DURATION` value.

## Raspberry Pi Notes

- The optional [`pigpio`](https://www.npmjs.com/package/pigpio) module provides precise timing and works well on modern Raspberry Pi kernels. When it is unavailable, the server falls back to a noop GPIO driver so you can still test the MCP integration.
- If you install `pigpio`, ensure the `pigpiod` daemon is running (`sudo systemctl enable --now pigpiod`).

## MCP Client Integration

1. Start the server.
2. Add a connector in ChatGPT (or your MCP client) pointing to `http://<host>:8001/.well-known/mcp/manifest.json`.
3. Call the `drive` tool with arguments such as:

```json
{
  "name": "drive",
  "arguments": { "cmd": "FORWARD", "duration": 1.5 }
}
```

## Troubleshooting

- Ensure Node 18.x is active; older releases may miss required standard library features.
- A startup warning such as `pigpio module not installed` means the high-performance backend was skipped; install it with `npm install pigpio --omit=dev --no-save` if you need real hardware control.
- If you encounter permission errors on Raspberry Pi, run the process with access to GPIO (`sudo` or membership in the `gpio` group`).

## License

MIT
