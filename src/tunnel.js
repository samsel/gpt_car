'use strict';

const { spawn } = require('node:child_process');

function isDisabled() {
  return process.env.GPT_CAR_DISABLE_TUNNEL === '1';
}

function sanitizeUrl(raw) {
  if (typeof raw !== 'string') {
    return raw;
  }
  return raw.replace(/[)\]\s]+$/, '');
}

async function stopProcess(child, logger = console) {
  if (!child) {
    return;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    child.once('exit', () => {
      done();
    });

    try {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    } catch (error) {
      logger?.error?.('Failed to terminate tunnel process', error);
      done();
      return;
    }

    setTimeout(() => {
      if (!resolved && child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch (error) {
          logger?.error?.('Failed to force terminate tunnel process', error);
        }
      }
      done();
    }, 2000);
  });
}

function startTunnel({ port, logger = console } = {}) {
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('startTunnel: port must be a positive integer');
  }

  if (isDisabled()) {
    logger?.info?.('Public tunnel disabled via GPT_CAR_DISABLE_TUNNEL=1');
    return Promise.resolve(null);
  }

  const sshCommand = process.env.GPT_CAR_TUNNEL_COMMAND || 'ssh';
  const serviceHost = process.env.GPT_CAR_TUNNEL_SERVICE || 'ssh.localhost.run';
  const remotePort = process.env.GPT_CAR_TUNNEL_REMOTE_PORT || '80';
  const localHost = process.env.GPT_CAR_TUNNEL_LOCALHOST || 'localhost';
  const timeoutMs = Number.parseInt(process.env.GPT_CAR_TUNNEL_TIMEOUT_MS || '15000', 10);
  const timeout = Number.isNaN(timeoutMs) ? 15000 : timeoutMs;

  const args = [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'ExitOnForwardFailure=yes',
    '-N',
    '-R',
    `${remotePort}:${localHost}:${port}`,
    serviceHost,
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    let tunnelUrl;

    const child = spawn(sshCommand, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const resolveWithTunnel = (url) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve({
        url,
        close: () => stopProcess(child, logger),
      });
    };

    const rejectWithError = (error) => {
      if (settled) {
        logger?.error?.('Tunnel process error after establishment', error);
        return;
      }
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(error);
    };

    const handleOutput = (chunk) => {
      const text = chunk.toString();
      if (!text) {
        return;
      }
      const match = text.match(/https?:\/\/[^\s]+/i);
      if (match) {
        tunnelUrl = sanitizeUrl(match[0]);
        logger?.info?.(`Public tunnel connected: ${tunnelUrl}`);
        resolveWithTunnel(tunnelUrl);
      }
    };

    const cleanup = () => {
      child.stdout.off('data', handleOutput);
      child.stderr.off('data', handleOutput);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    const onError = (error) => {
      rejectWithError(error);
    };

    const onExit = (code, signal) => {
      if (!settled) {
        const reason = code === 0 ? 'tunnel process exited unexpectedly' : `tunnel process exited with code ${code}${signal ? ` signal ${signal}` : ''}`;
        rejectWithError(new Error(reason));
      } else {
        logger?.warn?.('Tunnel process exited', { code, signal });
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        rejectWithError(new Error('Timed out establishing tunnel'));
      }
    }, timeout);

    child.stdout.on('data', handleOutput);
    child.stderr.on('data', handleOutput);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

module.exports = {
  startTunnel,
  _internal: { isDisabled, sanitizeUrl },
};
