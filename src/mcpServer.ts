import http, { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';
import ngrok from 'ngrok';
import type { ConnectOptions as NgrokConnectOptions } from 'ngrok';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  DEFAULT_PINS,
  MAX_DURATION,
  MotorController,
  MotorControllerError,
  type MotorCommand,
} from './motorController.js';
import { createGpio } from './gpio.js';

const APP_NAME = 'gpt-car-mcp-server';
const APP_VERSION = '1.0.0';
const MANIFEST_ROUTE = '/.well-known/mcp/manifest.json';
const ALT_MANIFEST_ROUTE = '/.well-known/manifest.json';
const MCP_ROUTE = '/mcp';

const DriveInputSchema = z.object({
  cmd: z.enum(['FORWARD', 'BACKWARD', 'LEFT', 'RIGHT', 'STOP']).describe('Direction command or STOP.'),
  duration: z
    .number()
    .positive()
    .max(MAX_DURATION)
    .optional()
    .describe('Optional duration in seconds, capped to the controller limit.'),
});

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

function createManifest(baseUrl: string) {
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
                { type: 'number', exclusiveMinimum: 0, maximum: MAX_DURATION },
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

  const token = process.env.GPT_CAR_NGROK_TOKEN ?? process.env.NGROK_AUTHTOKEN;
  if (!token) {
    console.warn(
      'ngrok tunneling skipped: set GPT_CAR_NGROK_TOKEN (or NGROK_AUTHTOKEN) to enable public access.',
    );
    return null;
  }

  await ngrok.authtoken(token);

  const options: NgrokConnectOptions = {
    addr: port,
    proto: 'http',
  };

  if (process.env.GPT_CAR_NGROK_REGION) {
    options.region = process.env.GPT_CAR_NGROK_REGION;
  }
  if (process.env.GPT_CAR_NGROK_SUBDOMAIN) {
    options.subdomain = process.env.GPT_CAR_NGROK_SUBDOMAIN;
  }
  if (process.env.GPT_CAR_NGROK_DOMAIN) {
    options.hostname = process.env.GPT_CAR_NGROK_DOMAIN;
  }

  const url = await ngrok.connect(options);
  console.log(`Tunnel ready at ${url}`);
  return {
    url,
    close: async () => {
      await ngrok.disconnect(url);
      await ngrok.kill();
    },
  };
}

export interface ServerOptions {
  host?: string;
  port?: number;
}

export async function bootstrapServer(options: ServerOptions = {}): Promise<http.Server> {
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? Number(process.env.PORT ?? 8001);

  const gpio = createGpio();
  const controller = new MotorController(gpio, DEFAULT_PINS);

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
      inputSchema: DriveInputSchema.shape,
    },
    async ({ cmd, duration }: DriveInput) => {
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
    const manifest = () => createManifest(inferBaseUrl(req));
    await handleRequest(req, res, transport, manifest);
  });

  let tunnelHandle: TunnelHandle | null = null;

  server.listen(port, host, async () => {
    console.log(`MCP server listening on http://${host}:${port}${MCP_ROUTE}`);
    try {
      tunnelHandle = await startTunnel(port);
      if (tunnelHandle) {
        console.log(`Public URL: ${tunnelHandle.url}`);
        server.on('close', () => {
          void tunnelHandle?.close();
          tunnelHandle = null;
        });
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.error('Failed to establish ngrok tunnel:', details);
      console.error(
        'Set GPT_CAR_NGROK_TOKEN (or disable tunneling with GPT_CAR_DISABLE_TUNNEL=1) if public access is not required.',
      );
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
};
