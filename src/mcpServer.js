import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  COMMAND_LIST,
  DEFAULT_PINS,
  MAX_DURATION,
  MotorController,
  MotorControllerError,
} from './motorController.js';
import { createGpio } from './gpio.js';

const APP_NAME = 'gpt-car-mcp-server';
const APP_VERSION = '1.0.0';
const MANIFEST_ROUTE = '/.well-known/mcp/manifest.json';
const ALT_MANIFEST_ROUTE = '/.well-known/manifest.json';
const MCP_ROUTE = '/mcp';

function driveResultToText(command, duration) {
  if (command === 'STOP') {
    return 'Motors stopped.';
  }
  const seconds = duration.toFixed(2).replace(/\.00$/, '');
  return `${command} executed for ${seconds} seconds.`;
}

function inferBaseUrl(req) {
  const socket = req.socket ?? {};
  const protocol = req.headers['x-forwarded-proto'] ?? (socket.encrypted ? 'https' : 'http');
  const host = req.headers.host ?? `${socket.localAddress}:${socket.localPort}`;
  return `${protocol}://${host}`.replace(/\/$/, '');
}

function parsePinEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    console.warn(`Ignoring ${name}: expected non-negative integer, received "${raw}".`);
    return undefined;
  }
  return value;
}

function parseDurationEnv(name, max) {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (typeof max === 'number' && value > max)) {
    console.warn(`Ignoring ${name}: value must be > 0${typeof max === 'number' ? ` and <= ${max}` : ''}. Received "${raw}".`);
    return undefined;
  }
  return value;
}

function resolveMotorConfiguration() {
  const pins = {
    forward: parsePinEnv('GPT_CAR_PIN_FORWARD') ?? DEFAULT_PINS.forward,
    backward: parsePinEnv('GPT_CAR_PIN_BACKWARD') ?? DEFAULT_PINS.backward,
    left: parsePinEnv('GPT_CAR_PIN_LEFT') ?? DEFAULT_PINS.left,
    right: parsePinEnv('GPT_CAR_PIN_RIGHT') ?? DEFAULT_PINS.right,
  };

  const maxDurationOverride = parseDurationEnv('GPT_CAR_MAX_DURATION');
  const maxDuration = maxDurationOverride ?? MAX_DURATION;
  const options = {};

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

function validateDriveInput(payload, maxDuration) {
  const errors = [];
  const result = {};

  if (!payload || typeof payload !== 'object') {
    throw new MotorControllerError('Input must be an object');
  }

  const { cmd, duration } = payload;
  if (typeof cmd !== 'string' || !COMMAND_LIST.includes(cmd.trim().toUpperCase())) {
    errors.push('cmd must be one of: ' + COMMAND_LIST.join(', '));
  } else {
    result.cmd = cmd.trim().toUpperCase();
  }

  if (duration !== undefined && duration !== null) {
    const numeric = Number(duration);
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > maxDuration) {
      errors.push(`duration must be > 0 and <= ${maxDuration}`);
    } else {
      result.duration = numeric;
    }
  }

  if (errors.length > 0) {
    throw new MotorControllerError(errors.join('; '));
  }

  return result;
}

function createManifest(baseUrl, maxDuration) {
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
          type: 'object',
          properties: {
            cmd: {
              type: 'string',
              enum: COMMAND_LIST,
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

async function readJsonBody(req) {
  const chunks = [];
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

function acceptsEventStream(req) {
  const acceptHeader = req.headers.accept;
  if (!acceptHeader) {
    return false;
  }

  const values = Array.isArray(acceptHeader) ? acceptHeader : [acceptHeader];
  return values.some((value) =>
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .some((part) => part === 'text/event-stream' || part.startsWith('text/event-stream;')),
  );
}

async function handleRequest(req, res, transport, manifestResponder) {
  if (!req.url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing request URL' }));
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const isRootPath = url.pathname === '/' || url.pathname === '';
  const wantsEventStream = acceptsEventStream(req);

  if (isRootPath && req.method === 'GET' && wantsEventStream && typeof transport.stream === 'function') {
    await transport.stream(req, res);
    return;
  }

  if (isRootPath && req.method === 'GET') {
    const baseUrl = inferBaseUrl(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          message: 'GPT Car MCP server',
          manifest: `${baseUrl}${MANIFEST_ROUTE}`,
          mcpEndpoint: `${baseUrl}${MCP_ROUTE}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (req.method === 'GET' && (url.pathname === MANIFEST_ROUTE || url.pathname === ALT_MANIFEST_ROUTE)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(manifestResponder(), null, 2));
    return;
  }

  const isMcpRoute = url.pathname === MCP_ROUTE || (isRootPath && req.method === 'POST');

  if (isMcpRoute) {
    if (req.method === 'GET') {
      if (!wantsEventStream || typeof transport.stream !== 'function') {
        res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'GET is only supported for event-stream connections' }));
        return;
      }

      await transport.stream(req, res);
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only POST and event-stream GET are supported for /mcp' }));
      return;
    }

    const contentTypeHeader = req.headers['content-type'];
    const contentTypes = Array.isArray(contentTypeHeader)
      ? contentTypeHeader
      : contentTypeHeader
        ? [contentTypeHeader]
        : [];
    const hasJsonContentType = contentTypes.some((value) =>
      typeof value === 'string' && value.toLowerCase().includes('application/json'),
    );

    if (!hasJsonContentType) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Expected application/json content type' }));
      return;
    }

    if (isRootPath) {
      req.url = MCP_ROUTE;
    }

    try {
      const parsedBody = await readJsonBody(req);
      const requestWithBody = req;
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

export async function bootstrapServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? Number(process.env.PORT ?? 8001);

  const gpio = createGpio();
  const { pins, options: controllerOptions, maxDuration } = resolveMotorConfiguration();
  const controller = new MotorController(gpio, pins, controllerOptions);

  const mcp = new McpServer(
    {
      name: APP_NAME,
      version: APP_VERSION,
    },
    {
      capabilities: { tools: {} },
      instructions: 'Use the drive tool to control the car motors.',
    },
  );

  mcp.registerTool(
    'drive',
    {
      title: 'Drive the car',
      description: 'Drive the car forward, backward, left, right or stop.',
      inputSchema: {
        type: 'object',
        properties: {
          cmd: { type: 'string' },
          duration: {
            anyOf: [
              { type: 'number' },
              { type: 'null' },
            ],
          },
        },
        required: ['cmd'],
        additionalProperties: false,
      },
    },
    async (input) => {
      try {
        const validated = validateDriveInput(input, maxDuration);
        const result = await controller.drive(validated.cmd, { duration: validated.duration ?? null });
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

  server.listen(port, host, () => {
    console.log(`MCP server listening on http://${host}:${port}${MCP_ROUTE}`);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    await transport.close();
    controller.cleanup();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

export async function main() {
  await bootstrapServer();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
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
  validateDriveInput,
  resolveMotorConfiguration,
  driveResultToText,
};
