
# GPT Car

The following is a simple ChatGPT app written following the guideliness specified out  in https://developers.openai.com/apps-sdk.
The project is a cool attempt to control a toy car using ChatGPT.
More info on the motivation and background is covered in the blog post: 
https://samselvanathan.com/posts/gpt-car/

## Tech details

This project exposes a tiny Model Context Protocol (MCP) server that controls a four-pin GPIO motor driver. The server registers a single `move_car` tool that ChatGPT (or any MCP-aware client) can call to move the car forward, backward, left, right, or stop or trun left, right.

## Key Points

- The mcp server is written in Typescript using the mcp sdk and the additional resources for the chatgpt app mentioned in chatgpt apps sdk developer docs.
- **Minimal dependencies** – only relies on `@modelcontextprotocol/sdk` `express` plus the optional `pigpio` GPIO helper.
- **Raspberry Pi friendly** – avoids heavy native extensions. The Rapberry Pi that i am using is from 2013 :) so it is a very small tiny less powerful computer. Getting NodeJs to work was a nightmare and anything to install there was taking a long time. Node 18 was the max node version i was able to build

## Project Structure

```
/
  car-controller/           // GPIO abstraction with pigpio and code to call car's motor controller using Rapsberry Pi
  mcp-server/        // MCP server setup and tool registration
  chatgpt-widget/       // a very very simple plain html client widget (ideally this should be written better with React)
```

## Prerequisites

- Node.js **18.x** (lightweight enough for Raspberry Pi OS Bookworm).
- npm 9 or newer.
- Hardware: Raspberry Pi or similar hardware with accessible GPIO pins. along with L298N Motor DC Dual H-Bridge Motor Driver Controller Board

## Installation

```bash
pnpm install 
```

## Running the Server

```bash
pnpm start
```

The server listens on port `3000` 



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

## Commands
- DANGEROUSLY_OMIT_AUTH=true npx @modelcontextprotocol/inspector
- sudo shutdown -h now  // to shutdown rapberry pi safely
