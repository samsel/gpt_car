'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const gpio = require('./gpio');
const { McpServer, ToolError } = require('./mcpServer');
const { MotorController, MotorControllerError, MAX_DURATION } = require('./motorController');

const APP_NAME = 'gpt-car-controller';
const APP_VERSION = '1.0.0';
const MANIFEST_ROUTE = '/.well-known/mcp/manifest.json';
const MCP_ROUTE = '/mcp';

const PINS = Object.freeze({ forward: 17, backward: 27, left: 22, right: 23 });
const controller = new MotorController(gpio, PINS);

const DRIVE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    cmd: {
      type: 'string',
      enum: ['FORWARD', 'BACKWARD', 'LEFT', 'RIGHT', 'STOP'],
      description: 'Direction or STOP.',
    },
    duration: {
      type: ['number', 'null'],
      minimum: 0,
      exclusiveMinimum: true,
      maximum: MAX_DURATION,
      description: 'Optional duration in seconds.',
    },
  },
  required: ['cmd'],
  additionalProperties: false,
};

const mcpServer = new McpServer({ name: APP_NAME, version: APP_VERSION });
mcpServer.registerTool(
  {
    name: 'drive',
    description: 'Drive the car forward, backward, left, right or stop.',
    inputSchema: DRIVE_TOOL_INPUT_SCHEMA,
  },
  async ({ cmd, duration = null }) => {
    if (typeof cmd !== 'string') {
      throw new ToolError('cmd must be a string', { code: -32602 });
    }
    try {
      const result = await controller.execute(cmd, { duration });
      return { status: 'ok', ...result };
    } catch (error) {
      if (error instanceof MotorControllerError) {
        throw new ToolError(error.message, {
          data: { httpStatus: error.statusCode },
        });
      }
      throw error;
    }
  }
);

function createHttpServer({
  controllerInstance = controller,
  mcp = mcpServer,
  manifestRoute = MANIFEST_ROUTE,
  rpcRoute = MCP_ROUTE,
} = {}) {
  return http.createServer(async (req, res) => {
    try {
      await handleRequest({ req, res, controllerInstance, mcp, manifestRoute, rpcRoute });
    } catch (error) {
      console.error('Unhandled server error', error);
      respondJson(res, 500, { status: 'error', message: 'Internal server error' });
    }
  });
}

async function handleRequest({ req, res, controllerInstance, mcp, manifestRoute, rpcRoute }) {
  const { method, url: rawUrl = '/' } = req;
  const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);

  if (method === 'GET' && url.pathname === manifestRoute) {
    const baseUrl = inferBaseUrl(req, url);
    const manifest = mcp.manifest(baseUrl, rpcRoute);
    return respondJson(res, 200, manifest);
  }

  if (method === 'POST' && url.pathname === '/command') {
    if (!isJsonRequest(req)) {
      return respondJson(res, 400, {
        status: 'error',
        message: 'JSON payload required',
      });
    }
    let payload;
    try {
      payload = await readJson(req);
    } catch (error) {
      return respondJson(res, 400, {
        status: 'error',
        message: 'Invalid JSON payload',
      });
    }
    const cmd = payload && payload.cmd;
    const duration = payload ? payload.duration : undefined;
    try {
      const result = await controllerInstance.execute(cmd, { duration });
      return respondJson(res, 200, { status: 'ok', ...result });
    } catch (error) {
      if (error instanceof MotorControllerError) {
        return respondJson(res, error.statusCode || 400, {
          status: 'error',
          message: error.message,
        });
      }
      throw error;
    }
  }

  if (method === 'POST' && url.pathname === rpcRoute) {
    if (!isJsonRequest(req)) {
      return respondJson(res, 400, {
        status: 'error',
        message: 'JSON payload required',
      });
    }
    let payload;
    try {
      payload = await readJson(req);
    } catch (error) {
      return respondJson(res, 400, {
        status: 'error',
        message: 'Invalid JSON payload',
      });
    }
    const response = await mcp.handleJsonRpc(payload);
    return respondJson(res, 200, response ?? {});
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
}

function isJsonRequest(req) {
  const contentType = req.headers['content-type'];
  return typeof contentType === 'string' && contentType.includes('application/json');
}

function respondJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function inferBaseUrl(req, url) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || `${url.hostname}:${url.port}`;
  if (!host) {
    return 'http://localhost';
  }
  return `${proto}://${host}`.replace(/\/$/, '');
}

async function main(args) {
  const options = parseArgs(args);
  const server = createHttpServer({ manifestRoute: MANIFEST_ROUTE, rpcRoute: MCP_ROUTE });
  server.listen(options.port, options.host, () => {
    console.log(`Server listening on http://${options.host}:${options.port}`);
  });

  const shutdown = async () => {
    server.close();
    await controller.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { host: '0.0.0.0', port: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host' && i + 1 < argv.length) {
      options.host = argv[i + 1];
      i += 1;
    } else if (arg === '--port' && i + 1 < argv.length) {
      options.port = Number(argv[i + 1]);
      if (!Number.isInteger(options.port)) {
        throw new Error('Port must be an integer');
      }
      i += 1;
    }
  }
  return options;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  APP_NAME,
  APP_VERSION,
  MANIFEST_ROUTE,
  MCP_ROUTE,
  PINS,
  controller,
  createHttpServer,
  DRIVE_TOOL_INPUT_SCHEMA,
  mcpServer,
  parseArgs,
};
