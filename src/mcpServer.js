'use strict';

const { JSONRPCServer, JSONRPCError } = require('json-rpc-2.0');

class ToolError extends JSONRPCError {
  constructor(message, { code = -32000, data = undefined } = {}) {
    super(message, code, data);
    this.name = 'ToolError';
  }
}

class McpServer {
  constructor({ name, version }) {
    if (!name) {
      throw new Error('Server name is required');
    }
    if (!version) {
      throw new Error('Server version is required');
    }

    this._name = name;
    this._version = version;
    this._tools = new Map();
    this._server = new JSONRPCServer();

    this._server.addMethod('ping', () => ({ message: 'pong' }));
    this._server.addMethod('initialize', () => ({
      protocolVersion: '1.0',
      serverInfo: { name: this._name, version: this._version },
      capabilities: { tools: { list: true, call: true } },
    }));
    this._server.addMethod('tools/list', () => ({
      tools: Array.from(this._tools.values()).map((tool) => this._manifestEntry(tool)),
    }));
    this._server.addMethod('tools/call', async (params) => {
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new JSONRPCError('Params must be an object', -32602);
      }
      const name = params.name;
      if (!this._tools.has(name)) {
        throw new JSONRPCError(`Unknown tool: ${name}`, -32601);
      }
      const tool = this._tools.get(name);
      const args = params.arguments ?? {};
      try {
        return await tool.handler(args);
      } catch (error) {
        if (error instanceof ToolError) {
          throw error;
        }
        if (error instanceof TypeError) {
          throw new JSONRPCError('Invalid arguments', -32602, {
            details: error.message,
          });
        }
        throw new ToolError(error?.message ?? 'Tool execution failed');
      }
    });
  }

  registerTool(options, handler) {
    if (!options || typeof options.name !== 'string') {
      throw new Error('Tool options with a name are required');
    }
    if (this._tools.has(options.name)) {
      throw new Error(`Tool ${options.name} already registered`);
    }
    const registration = {
      name: options.name,
      description: options.description,
      inputSchema: options.inputSchema || { type: 'object', properties: {} },
      handler,
    };
    this._tools.set(options.name, registration);
    return registration;
  }

  manifest(baseUrl, rpcRoute) {
    const url = `${baseUrl}${rpcRoute}`;
    return {
      id: this._name,
      version: this._version,
      name: { default: this._name.replace(/-/g, ' ') },
      description: {
        default: 'Server exposing registered tools over HTTP JSON-RPC.',
      },
      api: { type: 'http-jsonrpc', url },
      tools: Array.from(this._tools.values()).map((tool) => this._manifestEntry(tool)),
    };
  }

  async handleJsonRpc(payload) {
    const handle = async (message) => {
      const response = await this._server.receive(message);
      return response ?? null;
    };

    if (Array.isArray(payload)) {
      const responses = await Promise.all(payload.map((message) => handle(message)));
      return responses.filter((response) => response !== null);
    }
    return handle(payload);
  }

  _manifestEntry(tool) {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }
}

module.exports = {
  McpServer,
  ToolError,
};
