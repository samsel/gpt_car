'use strict';

const http = require('node:http');
const express = require('express');
const Ajv = require('ajv');

const gpio = require('./gpio');
const { McpServer, ToolError } = require('./mcpServer');
const { MotorController, MotorControllerError, MAX_DURATION } = require('./motorController');
const { startTunnel } = require('./tunnel');

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
      anyOf: [
        {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: MAX_DURATION,
        },
        { type: 'null' },
      ],
      description: 'Optional duration in seconds.',
    },
  },
  required: ['cmd'],
  additionalProperties: false,
};

const ajv = new Ajv({ removeAdditional: true, coerceTypes: true });
const validateDriveCommand = ajv.compile(DRIVE_TOOL_INPUT_SCHEMA);

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

function createExpressApp({
  controllerInstance = controller,
  mcp = mcpServer,
  manifestRoute = MANIFEST_ROUTE,
  rpcRoute = MCP_ROUTE,
} = {}) {
  const app = express();

  app.use(express.json());

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError) {
      return respondJson(res, 400, {
        status: 'error',
        message: 'Invalid JSON payload',
      });
    }
    return next(error);
  });

  app.get(manifestRoute, (req, res) => {
    const baseUrl = inferBaseUrl(req);
    const manifest = mcp.manifest(baseUrl, rpcRoute);
    respondJson(res, 200, manifest);
  });

  app.post('/command', requireJson, async (req, res, next) => {
    try {
      if (!validateDriveCommand(req.body)) {
        return respondJson(res, 400, {
          status: 'error',
          message: 'Invalid command payload',
          errors: validateDriveCommand.errors,
        });
      }
      const { cmd, duration = null } = req.body;
      const result = await controllerInstance.execute(cmd, { duration });
      respondJson(res, 200, { status: 'ok', ...result });
    } catch (error) {
      if (error instanceof MotorControllerError) {
        return respondJson(res, error.statusCode || 400, {
          status: 'error',
          message: error.message,
        });
      }
      return next(error);
    }
  });

  app.post(rpcRoute, requireJson, async (req, res, next) => {
    try {
      const response = await mcp.handleJsonRpc(req.body);
      respondJson(res, 200, response ?? {});
    } catch (error) {
      return next(error);
    }
  });

  app.use((req, res) => {
    respondJson(res, 404, { status: 'error', message: 'Not found' });
  });

  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error('Unhandled server error', error);
    respondJson(res, 500, { status: 'error', message: 'Internal server error' });
  });

  return app;
}

function createHttpServer(options = {}) {
  const app = createExpressApp(options);
  return http.createServer(app);
}

function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return respondJson(res, 400, {
      status: 'error',
      message: 'JSON payload required',
    });
  }
  return next();
}

function respondJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function inferBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('host');
  if (!host) {
    return 'http://localhost';
  }
  return `${proto}://${host}`.replace(/\/$/, '');
}

async function main(args) {
  const options = parseArgs(args);
  const server = createHttpServer({ manifestRoute: MANIFEST_ROUTE, rpcRoute: MCP_ROUTE });
  let tunnelController = null;

  server.listen(options.port, options.host, async () => {
    console.log(`Server listening on http://${options.host}:${options.port}`);

    try {
      tunnelController = await startTunnel({ port: options.port, logger: console });
      if (tunnelController && tunnelController.url) {
        console.log(`Public URL: ${tunnelController.url}`);
      } else if (process.env.GPT_CAR_DISABLE_TUNNEL === '1') {
        console.log('Public tunnel disabled by GPT_CAR_DISABLE_TUNNEL=1');
      }
    } catch (error) {
      console.error('Failed to establish public tunnel', error);
    }
  });

  const shutdown = async () => {
    server.close();
    if (tunnelController && typeof tunnelController.close === 'function') {
      try {
        await tunnelController.close();
      } catch (error) {
        console.error('Error while closing tunnel', error);
      }
    }
    await controller.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { host: '0.0.0.0', port: 8001 };
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
  createExpressApp,
  createHttpServer,
  DRIVE_TOOL_INPUT_SCHEMA,
  mcpServer,
  parseArgs,
};
