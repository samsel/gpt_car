'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { McpServer, ToolError } = require('../src/mcpServer');
const { MotorController, MotorControllerError } = require('../src/motorController');
const {
  APP_NAME,
  APP_VERSION,
  createHttpServer,
  DRIVE_TOOL_INPUT_SCHEMA,
  MCP_ROUTE,
  MANIFEST_ROUTE,
} = require('../src/server');
const { GpioStub } = require('./helpers/gpioStub');

const PINS = Object.freeze({ forward: 17, backward: 27, left: 22, right: 23 });

function createController(gpio) {
  return new MotorController(gpio, PINS, { sleep: () => Promise.resolve() });
}

function createMcp(controller) {
  const mcp = new McpServer({ name: APP_NAME, version: APP_VERSION });
  mcp.registerTool(
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
  return mcp;
}

async function startServer(controller, mcp) {
  const server = createHttpServer({ controllerInstance: controller, mcp });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl };
}

test('command endpoint requires JSON payload', async (t) => {
  const gpio = new GpioStub();
  const controller = createController(gpio);
  const mcp = createMcp(controller);
  const { server, baseUrl } = await startServer(controller, mcp);
  t.after(async () => {
    server.close();
    await controller.cleanup();
  });

  const response = await fetch(`${baseUrl}/command`, {
    method: 'POST',
    body: 'cmd=FORWARD',
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.deepEqual(payload, {
    status: 'error',
    message: 'JSON payload required',
  });
});

test('unknown commands are rejected', async (t) => {
  const gpio = new GpioStub();
  const controller = createController(gpio);
  const mcp = createMcp(controller);
  const { server, baseUrl } = await startServer(controller, mcp);
  t.after(async () => {
    server.close();
    await controller.cleanup();
  });

  const response = await fetch(`${baseUrl}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'spin' }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.status, 'error');
});

for (const [command, expectedPin] of [
  ['FORWARD', PINS.forward],
  ['BACKWARD', PINS.backward],
]) {
  test(`drive command ${command} toggles pins`, async (t) => {
    const gpio = new GpioStub();
    const controller = createController(gpio);
    const mcp = createMcp(controller);
    const { server, baseUrl } = await startServer(controller, mcp);
    t.after(async () => {
      server.close();
      await controller.cleanup();
    });

    const response = await fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: command, duration: 0.01 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'ok');
    const highEvents = gpio.log.filter((entry) => entry[2] === gpio.HIGH);
    assert.ok(highEvents.length > 0);
    assert.equal(highEvents[0][1], expectedPin);
    for (const pin of Object.values(PINS)) {
      assert.equal(gpio.outputs.get(pin), gpio.LOW);
    }
  });
}

for (const [command, expectedPin] of [
  ['LEFT', PINS.left],
  ['RIGHT', PINS.right],
]) {
  test(`turn command ${command} toggles pins`, async (t) => {
    const gpio = new GpioStub();
    const controller = createController(gpio);
    const mcp = createMcp(controller);
    const { server, baseUrl } = await startServer(controller, mcp);
    t.after(async () => {
      server.close();
      await controller.cleanup();
    });

    const response = await fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: command, duration: 0.01 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'ok');
    const highEvents = gpio.log.filter((entry) => entry[2] === gpio.HIGH);
    assert.ok(highEvents.length > 0);
    assert.equal(highEvents[0][1], expectedPin);
  });
}

test('stop command sets all pins low', async (t) => {
  const gpio = new GpioStub();
  const controller = createController(gpio);
  const mcp = createMcp(controller);
  const { server, baseUrl } = await startServer(controller, mcp);
  t.after(async () => {
    server.close();
    await controller.cleanup();
  });

  const response = await fetch(`${baseUrl}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'STOP' }),
  });
  assert.equal(response.status, 200);
  for (const pin of Object.values(PINS)) {
    assert.equal(gpio.outputs.get(pin), gpio.LOW);
  }
});

for (const invalid of ['abc', -1, 0, 'NaN', 'Infinity', 9]) {
  test(`invalid duration ${invalid} is rejected`, async (t) => {
    const gpio = new GpioStub();
    const controller = createController(gpio);
    const mcp = createMcp(controller);
    const { server, baseUrl } = await startServer(controller, mcp);
    t.after(async () => {
      server.close();
      await controller.cleanup();
    });

    const response = await fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'FORWARD', duration: invalid }),
    });
    assert.equal(response.status >= 400, true);
    const payload = await response.json();
    assert.equal(payload.status, 'error');
  });
}

test('cleanup prevents future commands', async (t) => {
  const gpio = new GpioStub();
  const controller = createController(gpio);
  const mcp = createMcp(controller);
  const { server, baseUrl } = await startServer(controller, mcp);
  t.after(async () => {
    server.close();
    await controller.cleanup();
  });

  await controller.cleanup();
  const response = await fetch(`${baseUrl}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'FORWARD' }),
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.status, 'error');
});

test('manifest exposes drive tool', async (t) => {
  const gpio = new GpioStub();
  const controller = createController(gpio);
  const mcp = createMcp(controller);
  const { server, baseUrl } = await startServer(controller, mcp);
  t.after(async () => {
    server.close();
    await controller.cleanup();
  });

  const response = await fetch(`${baseUrl}${MANIFEST_ROUTE}`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.id, APP_NAME);
  assert.ok(manifest.api.url.endsWith(MCP_ROUTE));
  const [tool] = manifest.tools;
  assert.equal(tool.name, 'drive');
  assert.ok(Object.prototype.hasOwnProperty.call(tool.inputSchema.properties, 'cmd'));
});

test('MCP tools/list exposes the drive tool', async (t) => {
  const gpio = new GpioStub();
  const controller = createController(gpio);
  const mcp = createMcp(controller);
  const { server, baseUrl } = await startServer(controller, mcp);
  t.after(async () => {
    server.close();
    await controller.cleanup();
  });

  const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const response = await fetch(`${baseUrl}${MCP_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.result.tools[0].name, 'drive');
});

test('MCP tools/call executes the drive tool', async (t) => {
  const gpio = new GpioStub();
  const controller = createController(gpio);
  const mcp = createMcp(controller);
  const { server, baseUrl } = await startServer(controller, mcp);
  t.after(async () => {
    server.close();
    await controller.cleanup();
  });

  const payload = {
    jsonrpc: '2.0',
    id: 'drive-1',
    method: 'tools/call',
    params: {
      name: 'drive',
      arguments: { cmd: 'FORWARD', duration: 0.01 },
    },
  };
  const response = await fetch(`${baseUrl}${MCP_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.result.status, 'ok');
  const highEvents = gpio.log.filter((entry) => entry[2] === gpio.HIGH);
  assert.ok(highEvents.length > 0);
  assert.equal(highEvents[0][1], PINS.forward);
});

test('MCP errors include controller status codes', async (t) => {
  const gpio = new GpioStub();
  const controller = createController(gpio);
  const mcp = createMcp(controller);
  const { server, baseUrl } = await startServer(controller, mcp);
  t.after(async () => {
    server.close();
    await controller.cleanup();
  });

  const payload = {
    jsonrpc: '2.0',
    id: 99,
    method: 'tools/call',
    params: { name: 'drive', arguments: { cmd: 'spin' } },
  };
  const response = await fetch(`${baseUrl}${MCP_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.error.code, -32000);
  assert.equal(result.error.data.httpStatus, 400);
});
