'use strict';
/**
 * Minimal MCP server inspired by the official TypeScript SDK API.
 */
class ToolError extends Error {
  constructor(message, { code = -32000, data = undefined } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.data = data;
  }
}

class McpToolRegistration {
  constructor(options, handler) {
    this.name = options.name;
    this.description = options.description;
    this.inputSchema = options.inputSchema || { type: 'object', properties: {} };
    this.handler = handler;
  }

  manifestEntry() {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
    };
  }

  async invoke(args) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      throw new ToolError('Arguments must be an object', { code: -32602 });
    }
    try {
      const result = this.handler(args);
      return await Promise.resolve(result);
    } catch (error) {
      if (error instanceof ToolError) {
        throw error;
      }
      if (error instanceof TypeError) {
        throw new ToolError('Invalid arguments', {
          code: -32602,
          data: { details: error.message },
        });
      }
      throw new ToolError(error.message || 'Tool invocation failed', {
        code: -32603,
      });
    }
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
  }

  registerTool(options, handler) {
    if (!options || typeof options.name !== 'string') {
      throw new Error('Tool options with a name are required');
    }
    if (this._tools.has(options.name)) {
      throw new Error(`Tool ${options.name} already registered`);
    }
    const registration = new McpToolRegistration(options, handler);
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
      tools: Array.from(this._tools.values()).map((tool) => tool.manifestEntry()),
    };
  }

  async handleJsonRpc(payload) {
    if (Array.isArray(payload)) {
      const responses = await Promise.all(
        payload.map(async (message) => this._handleMessage(message))
      );
      return responses.filter((response) => response !== null);
    }
    return this._handleMessage(payload);
  }

  async _handleMessage(message) {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      return this._errorResponse(null, -32600, 'Invalid request');
    }
    const jsonrpc = message.jsonrpc;
    const msgId = message.id;
    const method = message.method;
    if (jsonrpc !== '2.0') {
      return this._errorResponse(msgId, -32600, 'Invalid JSON-RPC version');
    }
    if (!method) {
      return this._errorResponse(msgId, -32600, 'Method is required');
    }
    if (method === 'ping') {
      return this._successResponse(msgId, { message: 'pong' });
    }
    if (method === 'initialize') {
      return this._successResponse(msgId, {
        protocolVersion: '1.0',
        serverInfo: { name: this._name, version: this._version },
        capabilities: { tools: { list: true, call: true } },
      });
    }
    if (method === 'tools/list') {
      return this._successResponse(msgId, {
        tools: Array.from(this._tools.values()).map((tool) => tool.manifestEntry()),
      });
    }
    if (method === 'tools/call') {
      const params = message.params;
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        return this._errorResponse(msgId, -32602, 'Params must be an object');
      }
      const name = params.name;
      const args = params.arguments || {};
      if (!this._tools.has(name)) {
        return this._errorResponse(msgId, -32601, `Unknown tool: ${name}`);
      }
      const tool = this._tools.get(name);
      try {
        const result = await tool.invoke(args);
        return this._successResponse(msgId, result);
      } catch (error) {
        if (error instanceof ToolError) {
          return this._errorResponse(msgId, error.code, error.message, {
            data: error.data,
          });
        }
        return this._errorResponse(msgId, -32603, error && error.message ? error.message : 'Tool execution failed');
      }
    }
    return this._errorResponse(msgId, -32601, `Unknown method: ${method}`);
  }

  _successResponse(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  _errorResponse(id, code, message, extra = {}) {
    const error = { code, message };
    if (extra && typeof extra === 'object' && extra.data !== undefined) {
      error.data = extra.data;
    }
    return { jsonrpc: '2.0', id, error };
  }
}

module.exports = {
  McpServer,
  ToolError,
};
