# GPT Car

> Drive a real-world RC car through ChatGPT Apps using the Model Context Protocol (MCP).

GPT Car is a minimal but complete MCP experience for steering a two-motor driver board from ChatGPT. It ships with:

- A TypeScript MCP server that exposes a single `move_car` tool.
- A GPIO controller that talks to an L298N dual H-bridge over Raspberry Pi GPIO pins.
- A lightweight HTML widget (hacky one as opposed to building a proper one with React, etc...) that surfaces tool inputs/outputs directly in the ChatGPT UI.

For the full story behind the project, read the blog post: [https://samselvanathan.com/posts/gpt-car/](https://samselvanathan.com/posts/gpt-car/).

---

## Table of Contents

1. [Project Goals](#project-goals)
2. [System Architecture](#system-architecture)
3. [Hardware & Prerequisites](#hardware--prerequisites)
4. [Quick Start](#quick-start)
5. [Running on Raspberry Pi](#running-on-raspberry-pi)
6. [Connecting from ChatGPT or another MCP client](#connecting-from-chatgpt-or-another-mcp-client)
7. [Tool Reference](#tool-reference)
8. [Widget](#widget)
9. [Development Tips](#development-tips)
10. [Troubleshooting & Safety](#troubleshooting--safety)
11. [Project Layout](#project-layout)
12. [License](#license)

---

## Project Goals

- **Practical demo** – Showcase how the ChatGPT Apps SDK and MCP can orchestrate physical hardware.
- **Simple surface area** – Keep the API small (`move_car`) so experimentation stays focused.
- **Raspberry Pi friendly** – Run comfortably on a 2013-era Raspberry Pi Model B with Node.js 18 and limited CPU.

## System Architecture

```text
/ (repo root)
├─ car-controller/      // Direction logic, GPIO abstraction, pigpio integration & simulation fallback
├─ mcp-server/          // Exposes the MCP tool & resource over streamable HTTP
└─ chatgpt-widget/      // Static HTML widget embedded in ChatGPT when the tool is invoked
```

Key interactions:

1. ChatGPT (or another MCP client) calls the `move_car` tool.
2. The MCP server validates the payload with [`zod`](https://zod.dev), then delegates to the GPIO controller.
3. `car-controller` toggles GPIO pins using [`pigpio`](https://www.npmjs.com/package/pigpio) when available, or logs simulated moves if running off-device.
4. A Skybridge-compatible widget renders the live tool I/O inside ChatGPT for transparency.

## Hardware & Prerequisites

| Requirement | Why it matters |
|-------------|----------------|
| **Node.js 18.x** | Highest version that could be reliably compiled on the vintage Pi used during development. |
| **pnpm 8+** (or adapt commands for npm/yarn) | Used for dependency management and scripts. |
| **Raspberry Pi with accessible GPIO** | Tested on an older Pi running Raspberry Pi OS Bookworm. |
| **L298N (or similar) dual H-bridge motor driver** | Drives the four-channel DC motors on the RC chassis. |
| **Optional: pigpio** | Precise timing & PWM. Falls back to a noop simulator when absent. |

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build TypeScript & copy widget assets
pnpm run build

# 3. Start the MCP server (builds automatically if needed)
pnpm start
```

The server runs on `http://localhost:3000/mcp` by default. Logs will mention whether GPIO pins were initialized or if the simulator is active. To make this accessible on Chatgpt, a tunnel tool like `ngrok` needs to be used.

## Running on Raspberry Pi

1. **Install Node.js 18** – The vintage Pi that I am using requires compiling from source; patience is key.
2. **Install dependencies** – `pnpm install`.
3. **Enable the pigpio daemon** – `sudo systemctl enable --now pigpiod`.
4. **Wire the H-bridge** – Connect GPIO pins `17`, `27`, `22`, `23` to the driver inputs matching the constants in `car-controller/index.ts`.
5. **Run the server** – `pnpm start`. See `GPIO pins initialized successfully.` in the logs.
6. **Shutdown safely** – Use `sudo shutdown -h now` when done to protect the SD card and hardware.

### GPIO Fallback Simulation
If `pigpio` fails to load (common on non-Pi platforms), `car-controller` prints messages like `Simulated move car: FORWARD for 2 seconds`. You can still exercise the full MCP flow, including ChatGPT integration, without hardware attached.

## Connecting from ChatGPT or another MCP client

1. Start the server locally or expose it via tunneling (e.g., [`ngrok`](https://ngrok.com/) or `cloudflared`).
2. To test, use the [MCP inspector](https://github.com/modelcontextprotocol/inspector):
   ```bash
   DANGEROUSLY_OMIT_AUTH=true npx @modelcontextprotocol/inspector
   ```
3. In ChatGPT, create a **App** https://developers.openai.com/apps-sdk.
4. Chat with ChatGPT. When it chooses `move_car`, you will see the dashboard widget appear with live inputs/outputs.

The server uses **Streamable HTTP** transport, so each request/response is self-contained—perfect for stateless tunnels.

## Tool Reference

`move_car` is currently the only tool and is intentionally small:

| Field      | Type    | Required | Notes |
|------------|---------|----------|-------|
| `direction`| Enum    | ✅       | One of `FORWARD`, `BACKWARD`, `LEFT`, `RIGHT`. Opposing directions are never driven simultaneously. |
| `duration` | Number  | ✅       | Seconds between `1` and `4`. Internally clamped to a maximum of `5` seconds for safety. |

Responses include a structured payload:

```json
{
  "result": {
    "action": "MOVED_FORWARD_FOR_2_SECONDS"
  }
}
```

## Widget

A minimal Skybridge-compatible widget (`chatgpt-widget/index.html`) renders inside ChatGPT when the tool runs. It:

- Uses [Pico.css](https://picocss.com) for styling.
- Displays tool inputs and outputs with live updates through a simple `Proxy` wrapper over `window.openai`.

## Project Layout

```
.
├── car-controller/
│   ├── index.ts               # Direction enums, duration clamping, GPIO initialization & safety logic
│   └── utils/raspberrypi.ts   # Detects Raspberry Pi hardware to decide whether to load pigpio
├── mcp-server/
│   └── index.ts               # MCP server setup, tool registration, resource hosting, Streamable HTTP transport
├── chatgpt-widget/
│   └── index.html             # Skybridge-compatible dashboard surfaced inside ChatGPT
├── package.json               # Scripts & dependencies (express, @modelcontextprotocol/sdk, zod, pigpio optional)
├── tsconfig.json              # NodeNext config targeting ES2023
└── README.md                  # You are here
```
