'use strict';

const { Mutex } = require('async-mutex');

const DEFAULT_DRIVE_DURATION = 2.0;
const DEFAULT_TURN_DURATION = 1.0;
const MAX_DURATION = 5.0;

class MotorControllerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'MotorControllerError';
    this.statusCode = statusCode;
  }
}

class MotorController {
  constructor(gpio, pins, options = {}) {
    this._gpio = gpio;
    this._pins = pins;
    this._driveDuration = options.driveDuration ?? DEFAULT_DRIVE_DURATION;
    this._turnDuration = options.turnDuration ?? DEFAULT_TURN_DURATION;
    this._maxDuration = options.maxDuration ?? MAX_DURATION;
    this._sleep = options.sleep ?? ((seconds) => new Promise((resolve) => setTimeout(resolve, Math.round(seconds * 1000))));
    this._mutex = new Mutex();
    this._cleaned = false;

    this._gpio.setwarnings(false);
    this._gpio.setmode(this._gpio.BCM);
    for (const pin of this._allPins()) {
      this._gpio.setup(pin, this._gpio.OUT);
      this._gpio.output(pin, this._gpio.LOW);
    }
  }

  async cleanup() {
    return this._withLock(async () => {
      if (this._cleaned) {
        return;
      }
      this._stopLocked();
      if (typeof this._gpio.cleanup === 'function') {
        this._gpio.cleanup();
      }
      this._cleaned = true;
    });
  }

  async stop() {
    return this._withLock(async () => {
      this._ensureActive();
      this._stopLocked();
      return { message: 'Motors stopped' };
    });
  }

  async execute(command, { duration } = {}) {
    const normalized = typeof command === 'string' ? command.trim().toUpperCase() : '';
    if (!normalized) {
      throw new MotorControllerError('Command is required');
    }

    if (normalized === 'STOP') {
      return this.stop();
    }

    if (normalized === 'FORWARD' || normalized === 'BACKWARD') {
      const pins = this._selectDrivePins(normalized);
      const actualDuration = await this._runWithDuration(pins, duration, this._driveDuration);
      return {
        message: `Moving ${normalized.toLowerCase()}`,
        duration: actualDuration,
      };
    }

    if (normalized === 'LEFT' || normalized === 'RIGHT') {
      const pins = this._selectTurnPins(normalized);
      const actualDuration = await this._runWithDuration(pins, duration, this._turnDuration);
      return {
        message: `Turning ${normalized.toLowerCase()}`,
        duration: actualDuration,
      };
    }

    throw new MotorControllerError('Unknown command');
  }

  _ensureActive() {
    if (this._cleaned) {
      throw new MotorControllerError('Controller is shut down', 503);
    }
  }

  _selectDrivePins(command) {
    if (command === 'FORWARD') {
      return [this._pins.forward, this._pins.backward];
    }
    return [this._pins.backward, this._pins.forward];
  }

  _selectTurnPins(command) {
    if (command === 'LEFT') {
      return [this._pins.left, this._pins.right];
    }
    return [this._pins.right, this._pins.left];
  }

  async _runWithDuration(pins, requestedDuration, defaultDuration) {
    const duration = this._normalizeDuration(requestedDuration, defaultDuration);
    return this._withLock(async () => {
      this._ensureActive();
      const [forwardPin, backwardPin] = pins;
      this._gpio.output(forwardPin, this._gpio.HIGH);
      this._gpio.output(backwardPin, this._gpio.LOW);
      await Promise.resolve(this._sleep(duration));
      this._stopLocked();
      return duration;
    });
  }

  async _withLock(fn) {
    return this._mutex.runExclusive(fn);
  }

  _stopLocked() {
    for (const pin of this._allPins()) {
      this._gpio.output(pin, this._gpio.LOW);
    }
  }

  _normalizeDuration(value, defaultValue) {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new MotorControllerError('Duration must be finite');
    }
    if (numeric <= 0) {
      throw new MotorControllerError('Duration must be positive');
    }
    if (numeric > this._maxDuration) {
      throw new MotorControllerError(`Duration must be <= ${this._maxDuration} seconds`);
    }
    return numeric;
  }

  _allPins() {
    return [this._pins.forward, this._pins.backward, this._pins.left, this._pins.right];
  }
}

module.exports = {
  DEFAULT_DRIVE_DURATION,
  DEFAULT_TURN_DURATION,
  MAX_DURATION,
  MotorController,
  MotorControllerError,
};
