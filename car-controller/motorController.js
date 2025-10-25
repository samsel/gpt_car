const COMMANDS = ['FORWARD', 'BACKWARD', 'LEFT', 'RIGHT', 'STOP'];

export const DEFAULT_DRIVE_DURATION = 2;
export const DEFAULT_TURN_DURATION = 1;
export const MAX_DURATION = 5;

export const DEFAULT_PINS = Object.freeze({
  forward: 17,
  backward: 27,
  left: 22,
  right: 23,
});

export class MotorControllerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'MotorControllerError';
    this.statusCode = statusCode;
  }
}

function defaultSleep(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeCommand(value) {
  const normalized = String(value).trim().toUpperCase();
  if (!COMMANDS.includes(normalized)) {
    throw new MotorControllerError(`Unsupported command: ${value}`);
  }
  return normalized;
}

export class MotorController {
  constructor(gpio, pins = DEFAULT_PINS, options = {}) {
    if (!gpio) {
      throw new MotorControllerError('GPIO instance is required');
    }

    this.gpio = gpio;
    this.pins = pins;
    this.driveDuration = options.driveDuration ?? DEFAULT_DRIVE_DURATION;
    this.turnDuration = options.turnDuration ?? DEFAULT_TURN_DURATION;
    this.maxDuration = options.maxDuration ?? MAX_DURATION;
    this.sleepFn = options.sleep ?? defaultSleep;
    this.active = true;

    this.configurePins();
  }

  async drive(command, { duration = null } = {}) {
    const normalized = normalizeCommand(command);
    if (normalized === 'STOP') {
      this.stop();
      return { command: normalized, duration: 0 };
    }

    const resolvedDuration = this.resolveDuration(normalized, duration);
    const { activePin, inactivePin } = this.pinsForCommand(normalized);

    this.ensureActive();
    this.gpio.output(activePin, this.highValue());
    this.gpio.output(inactivePin, this.lowValue());
    await this.sleepFn(resolvedDuration);
    this.stop();

    return { command: normalized, duration: resolvedDuration };
  }

  stop() {
    this.ensureActive();
    for (const pin of this.allPins()) {
      this.gpio.output(pin, this.lowValue());
    }
    return { command: 'STOP', duration: 0 };
  }

  cleanup() {
    if (!this.active) {
      return;
    }
    this.stop();
    if (typeof this.gpio.cleanup === 'function') {
      this.gpio.cleanup();
    }
    this.active = false;
  }

  configurePins() {
    if (typeof this.gpio.setwarnings === 'function') {
      this.gpio.setwarnings(false);
    }
    if (this.gpio.BCM !== undefined && typeof this.gpio.setmode === 'function') {
      this.gpio.setmode(this.gpio.BCM);
    }
    for (const pin of this.allPins()) {
      if (typeof this.gpio.setup === 'function') {
        this.gpio.setup(pin, this.gpio.OUT);
      }
      this.gpio.output(pin, this.lowValue());
    }
  }

  pinsForCommand(command) {
    switch (command) {
      case 'FORWARD':
        return { activePin: this.pins.forward, inactivePin: this.pins.backward };
      case 'BACKWARD':
        return { activePin: this.pins.backward, inactivePin: this.pins.forward };
      case 'LEFT':
        return { activePin: this.pins.left, inactivePin: this.pins.right };
      case 'RIGHT':
        return { activePin: this.pins.right, inactivePin: this.pins.left };
      default:
        throw new MotorControllerError(`Unsupported command: ${command}`);
    }
  }

  resolveDuration(command, value) {
    if (value == null) {
      return command === 'LEFT' || command === 'RIGHT' ? this.turnDuration : this.driveDuration;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new MotorControllerError('Duration must be a number');
    }
    if (numeric <= 0) {
      throw new MotorControllerError('Duration must be positive');
    }
    if (numeric > this.maxDuration) {
      throw new MotorControllerError(`Duration must be <= ${this.maxDuration} seconds`);
    }
    return numeric;
  }

  allPins() {
    return [this.pins.forward, this.pins.backward, this.pins.left, this.pins.right];
  }

  ensureActive() {
    if (!this.active) {
      throw new MotorControllerError('Controller has been cleaned up', 503);
    }
  }

  highValue() {
    return this.gpio.HIGH ?? 1;
  }

  lowValue() {
    return this.gpio.LOW ?? 0;
  }
}

export const COMMAND_LIST = COMMANDS;
