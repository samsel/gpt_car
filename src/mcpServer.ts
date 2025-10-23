import http, { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';
import type { Tunnel as LocalTunnel, TunnelConfig as LocalTunnelConfig } from 'localtunnel';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  DEFAULT_PINS,
  MAX_DURATION,
  MotorController,
  MotorControllerError,
  type MotorPins,
  type MotorControllerOptions,
  type MotorCommand,
} from './motorController.js';
import { createGpio } from './gpio.js';

const APP_NAME = 'gpt-car-mcp-server';
const APP_VERSION = '1.0.0';
const MANIFEST_ROUTE = '/.well-known/mcp/manifest.json';
const ALT_MANIFEST_ROUTE = '/.well-known/manifest.json';
const MCP_ROUTE = '/mcp';

const DRIVE_COMMANDS = ['FORWARD', 'BACKWARD', 'LEFT', 'RIGHT', 'STOP'] as const;

const createDriveInputSchema = (maxDuration: number) =>
  z.object({
    cmd: z.enum(DRIVE_COMMANDS).describe('Direction command or STOP.'),
    duration: z
      .number({ invalid_type_error: 'Duration must be a number' })
      .positive()
      .max(maxDuration)
      .nullish()
      .describe('Optional duration in seconds, capped to the controller limit.'),
  });

const DriveInputSchema = createDriveInputSchema(MAX_DURATION);

type DriveInput = z.infer<typeof DriveInputSchema>;

function inferBaseUrl(req: IncomingMessage): string {
  const socket = req.socket as { encrypted?: boolean; localAddress?: string; localPort?: number };
  const protocol =
    (req.headers['x-forwarded-proto'] as string | undefined) ??
    (socket.encrypted ? 'https' : 'http');
  const host = req.headers.host ?? `${socket.localAddress}:${socket.localPort}`;
  return `${protocol}://${host}`.replace(/\/$/, '');
}

function driveResultToText(command: MotorCommand, duration: number): string {
  if (command === 'STOP') {
    return 'Motors stopped.';
  }
  return `${command} executed for ${duration.toFixed(2)} seconds.`;
}

function createManifest(baseUrl: string, maxDuration: number) {
  return {
    id: APP_NAME,
    version: APP_VERSION,
    name: { default: 'GPT Car Controller' },
    description: { default: 'Motor control tools for the GPT car.' },
    api: { type: 'http-jsonrpc', url: `${baseUrl}${MCP_ROUTE}` },
    tools: [
      {
        name: 'drive',
        description: 'Drive the car forward, backward, left, right or stop.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            cmd: {
              type: 'string',
              enum: ['FORWARD', 'BACKWARD', 'LEFT', 'RIGHT', 'STOP'],
              description: 'Direction command or STOP.',
            },
            duration: {
              anyOf: [
                { type: 'number', exclusiveMinimum: 0, maximum: maxDuration },
                { type: 'null' },
              ],
              description: 'Optional duration in seconds.',
            },
          },
          required: ['cmd'],
          additionalProperties: false,
        },
      },
    ],
  };
}

function parsePinEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) {
    console.warn(`Ignoring ${name}: expected an integer BCM pin number, received "${raw}".`);
    return undefined;
  }
  if (value < 0) {
    console.warn(`${name} must be non-negative. Received ${value}.`);
    return undefined;
  }
  return value;
}

function parseDurationEnv(name: string, max?: number): number | undefined {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.warn(`Ignoring ${name}: expected a numeric duration, received "${raw}".`);
    return undefined;
  }
  if (value <= 0) {
    console.warn(`${name} must be greater than zero. Received ${value}.`);
    return undefined;
  }
  if (typeof max === 'number' && value > max) {
    console.warn(`${name} must be <= ${max}. Received ${value}.`);
    return undefined;
  }
  return value;
}

function resolveMotorConfiguration(): {
  pins: MotorPins;
  options: MotorControllerOptions;
  maxDuration: number;
} {
  const pins: MotorPins = {
    forward: parsePinEnv('GPT_CAR_PIN_FORWARD') ?? DEFAULT_PINS.forward,
    backward: parsePinEnv('GPT_CAR_PIN_BACKWARD') ?? DEFAULT_PINS.backward,
    left: parsePinEnv('GPT_CAR_PIN_LEFT') ?? DEFAULT_PINS.left,
    right: parsePinEnv('GPT_CAR_PIN_RIGHT') ?? DEFAULT_PINS.right,
  };

  const maxDurationOverride = parseDurationEnv('GPT_CAR_MAX_DURATION');
  const maxDuration = maxDurationOverride ?? MAX_DURATION;

  const options: MotorControllerOptions = {};
  if (maxDurationOverride !== undefined) {
    options.maxDuration = maxDuration;
  }

  const driveDuration = parseDurationEnv('GPT_CAR_DRIVE_DURATION', maxDuration);
  if (driveDuration !== undefined) {
    options.driveDuration = driveDuration;
  }

  const turnDuration = parseDurationEnv('GPT_CAR_TURN_DURATION', maxDuration);
  if (turnDuration !== undefined) {
    options.turnDuration = turnDuration;
  }

  return { pins, options, maxDuration };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const payload = Buffer.concat(chunks).toString('utf8').trim();
  if (!payload) {
    return {};
  }
  try {
    return JSON.parse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON payload: ${message}`);
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  transport: StreamableHTTPServerTransport,
  manifestResponder: () => unknown,
): Promise<void> {
  if (!req.url) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing request URL' }));
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === MANIFEST_ROUTE || url.pathname === ALT_MANIFEST_ROUTE)) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(manifestResponder(), null, 2));
    return;
  }

  if (url.pathname === MCP_ROUTE) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Only POST is supported for /mcp' }));
      return;
    }

    if (!req.headers['content-type']?.includes('application/json')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Expected application/json content type' }));
      return;
    }

    try {
      const parsedBody = await readJsonBody(req);
      const requestWithBody = req as IncomingMessage & { body?: unknown };
      requestWithBody.body = parsedBody;
      await transport.handleRequest(requestWithBody, res, parsedBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message } }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

interface TunnelHandle {
  url: string;
  close: () => Promise<void>;
}
async function startTunnel(port: number): Promise<TunnelHandle | null> {
  if (process.env.GPT_CAR_DISABLE_TUNNEL === '1') {
    return null;
  }

  try {
    const { default: localtunnel } = await import('localtunnel');
    const config: LocalTunnelConfig & { port: number } = { port };
    const subdomain = process.env.GPT_CAR_LOCALTUNNEL_SUBDOMAIN ?? process.env.GPT_CAR_LT_SUBDOMAIN;
    if (subdomain) {
      config.subdomain = subdomain;
    }
    const host = process.env.GPT_CAR_LOCALTUNNEL_HOST;
    if (host) {
      config.host = host;
    }

    const tunnel: LocalTunnel = await localtunnel(config);
    return {
      url: tunnel.url,
      close: async () => {
        try {
          tunnel.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`localtunnel close failed: ${message}`);
        }
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`localtunnel unavailable, continuing without public tunnel: ${message}`);
    return null;
  }
}

export interface ServerOptions {
  host?: string;
  port?: number;
}

export async function bootstrapServer(options: ServerOptions = {}): Promise<http.Server> {
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? Number(process.env.PORT ?? 8001);

  const gpio = createGpio();
  const { pins, options: controllerOptions, maxDuration } = resolveMotorConfiguration();
  const controller = new MotorController(gpio, pins, controllerOptions);
  const driveInputSchema = createDriveInputSchema(maxDuration);
  type DriveToolInput = z.infer<typeof driveInputSchema>;

  const mcp = new McpServer(
    {
      name: APP_NAME,
      version: APP_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: 'Use the drive tool to control the car motors.',
    },
  );

  mcp.registerTool(
    'drive',
    {
      title: 'Drive the car',
      description: 'Drive the car forward, backward, left, right or stop.',
      inputSchema: driveInputSchema.shape,
    },
    async ({ cmd, duration }: DriveToolInput) => {
      try {
        const result = await controller.drive(cmd, { duration: duration ?? null });
        return {
          content: [
            {
              type: 'text',
              text: driveResultToText(result.command, result.duration),
            },
          ],
        };
      } catch (error) {
        if (error instanceof MotorControllerError) {
          return {
            content: [
              {
                type: 'text',
                text: `Motor controller error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    },
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  await mcp.connect(transport);

  const server = http.createServer(async (req, res) => {
    const manifest = () => createManifest(inferBaseUrl(req), maxDuration);
    await handleRequest(req, res, transport, manifest);
  });

  let tunnelHandle: TunnelHandle | null = null;

  server.listen(port, host, async () => {
    console.log(`MCP server listening on http://${host}:${port}${MCP_ROUTE}`);
    tunnelHandle = await startTunnel(port);
    if (tunnelHandle) {
      console.log(`Public URL: ${tunnelHandle.url}`);
      server.on('close', () => {
        void tunnelHandle?.close();
        tunnelHandle = null;
      });
    } else {
      console.warn('No tunnel active. Set GPT_CAR_DISABLE_TUNNEL=1 to silence this warning.');
    }
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    if (tunnelHandle) {
      await tunnelHandle.close();
      tunnelHandle = null;
    }
    await transport.close();
    controller.cleanup();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

export async function main(): Promise<void> {
  await bootstrapServer();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const details = error instanceof Error ? error : String(error);
    console.error(details);
    process.exit(1);
  });
}

export {
  APP_NAME,
  APP_VERSION,
  MANIFEST_ROUTE,
  ALT_MANIFEST_ROUTE,
  MCP_ROUTE,
  DriveInputSchema,
  createDriveInputSchema,
};
