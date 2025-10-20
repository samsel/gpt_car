import type { GpioController } from './gpio.js';
export type { GpioController } from './gpio.js';

export type MotorCommand = 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT' | 'STOP';

export interface MotorPins {
  readonly forward: number;
  readonly backward: number;
  readonly left: number;
  readonly right: number;
}

export interface MotorControllerOptions {
  driveDuration?: number;
  turnDuration?: number;
  maxDuration?: number;
  sleep?: (seconds: number) => Promise<void>;
}

export interface DriveResult {
  command: MotorCommand;
  duration: number;
}

export const DEFAULT_DRIVE_DURATION = 2;
export const DEFAULT_TURN_DURATION = 1;
export const MAX_DURATION = 5;

export const DEFAULT_PINS: Readonly<MotorPins> = Object.freeze({
  forward: 17,
  backward: 27,
  left: 22,
  right: 23,
});

export class MotorControllerError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'MotorControllerError';
    this.statusCode = statusCode;
  }
}

const COMMANDS: ReadonlyArray<MotorCommand> = ['FORWARD', 'BACKWARD', 'LEFT', 'RIGHT', 'STOP'];

function defaultSleep(seconds: number): Promise<void> {
  const milliseconds = Math.round(seconds * 1000);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeCommand(value: string): MotorCommand {
  const normalized = value.trim().toUpperCase();
  if (!COMMANDS.includes(normalized as MotorCommand)) {
    throw new MotorControllerError(`Unsupported command: ${value}`);
  }
  return normalized as MotorCommand;
}

export class MotorController {
  private readonly gpio: GpioController;
  private readonly pins: MotorPins;
  private readonly driveDuration: number;
  private readonly turnDuration: number;
  private readonly maxDuration: number;
  private readonly sleepFn: (seconds: number) => Promise<void>;
  private active = true;

  constructor(gpio: GpioController, pins: MotorPins = DEFAULT_PINS, options: MotorControllerOptions = {}) {
    if (!gpio) {
      throw new MotorControllerError('GPIO instance is required');
    }

    this.gpio = gpio;
    this.pins = pins;
    this.driveDuration = options.driveDuration ?? DEFAULT_DRIVE_DURATION;
    this.turnDuration = options.turnDuration ?? DEFAULT_TURN_DURATION;
    this.maxDuration = options.maxDuration ?? MAX_DURATION;
    this.sleepFn = options.sleep ?? defaultSleep;

    this.configurePins();
  }

  async drive(command: string, options: { duration?: number | null } = {}): Promise<DriveResult> {
    const normalized = normalizeCommand(command);
    if (normalized === 'STOP') {
      this.stop();
      return { command: normalized, duration: 0 };
    }

    const duration = this.resolveDuration(normalized, options.duration);
    const { activePin, inactivePin } = this.pinsForCommand(normalized);

    this.ensureActive();
    this.gpio.output(activePin, this.highValue());
    this.gpio.output(inactivePin, this.lowValue());
    await this.sleepFn(duration);
    this.stop();

    return { command: normalized, duration };
  }

  stop(): DriveResult {
    this.ensureActive();
    for (const pin of this.allPins()) {
      this.gpio.output(pin, this.lowValue());
    }
    return { command: 'STOP', duration: 0 };
  }

  cleanup(): void {
    if (!this.active) {
      return;
    }
    this.stop();
    this.gpio.cleanup?.();
    this.active = false;
  }

  private configurePins(): void {
    this.gpio.setwarnings?.(false);
    if (this.gpio.BCM !== undefined) {
      this.gpio.setmode?.(this.gpio.BCM);
    }
    for (const pin of this.allPins()) {
      this.gpio.setup?.(pin, this.gpio.OUT);
      this.gpio.output(pin, this.lowValue());
    }
  }

  private pinsForCommand(command: MotorCommand): { activePin: number; inactivePin: number } {
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

  private resolveDuration(command: MotorCommand, value?: number | null): number {
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

  private allPins(): number[] {
    return [this.pins.forward, this.pins.backward, this.pins.left, this.pins.right];
  }

  private ensureActive(): void {
    if (!this.active) {
      throw new MotorControllerError('Controller has been cleaned up', 503);
    }
  }

  private highValue(): number {
    return this.gpio.HIGH ?? 1;
  }

  private lowValue(): number {
    return this.gpio.LOW ?? 0;
  }
}
