import { createRequire } from 'node:module';
import type { Gpio as OnoffGpioInstance } from 'onoff';

const require = createRequire(import.meta.url);

export interface GpioController {
  BCM?: number | string;
  OUT?: number | string;
  HIGH?: number;
  LOW?: number;
  setwarnings?(flag: boolean): void;
  setmode?(mode: number | string): void;
  setup?(pin: number, mode?: number | string): void;
  output(pin: number, value: number): void;
  cleanup?(): void;
}

class NoopGpio implements GpioController {
  BCM = 11;
  OUT = 0;
  HIGH = 1;
  LOW = 0;
  private readonly state = new Map<number, number>();

  setwarnings(): void {
    // no-op
  }

  setmode(): void {
    // no-op
  }

  setup(pin: number): void {
    this.state.set(pin, this.LOW);
  }

  output(pin: number, value: number): void {
    this.state.set(pin, value);
  }

  cleanup(): void {
    this.state.clear();
  }
}

type OnoffGpioCtor = typeof import('onoff').Gpio;

function createOnoffFacade(GpioClass: OnoffGpioCtor): GpioController {
  const pins = new Map<number, OnoffGpioInstance>();

  return {
    BCM: 'bcm',
    OUT: 'out',
    HIGH: 1,
    LOW: 0,
    setwarnings() {},
    setmode() {},
    setup(pin: number) {
      if (!pins.has(pin)) {
        const gpio = new GpioClass(pin, 'out');
        gpio.writeSync(0);
        pins.set(pin, gpio);
      }
    },
    output(pin: number, value: number) {
      let gpio = pins.get(pin);
      if (!gpio) {
        gpio = new GpioClass(pin, 'out');
        pins.set(pin, gpio);
      }
      const normalized: 0 | 1 = value === 0 ? 0 : 1;
      gpio.writeSync(normalized);
    },
    cleanup() {
      for (const gpio of pins.values()) {
        try {
          gpio.writeSync(0);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Failed to reset GPIO pin during cleanup: ${message}`);
        }
        gpio.unexport();
      }
      pins.clear();
    },
  };
}

interface PigpioGpioInstance {
  digitalWrite(value: 0 | 1): void;
  mode?(mode: number): void;
}

interface PigpioGpioCtor {
  new (pin: number, options?: { mode?: number }): PigpioGpioInstance;
  readonly INPUT?: number;
  readonly OUTPUT?: number;
}

interface PigpioModule {
  readonly Gpio: PigpioGpioCtor;
}

function createPigpioFacade(GpioClass: PigpioGpioCtor): GpioController {
  const pins = new Map<number, PigpioGpioInstance>();
  const outputMode = typeof GpioClass.OUTPUT === 'number' ? GpioClass.OUTPUT : 1;
  const inputMode = typeof GpioClass.INPUT === 'number' ? GpioClass.INPUT : undefined;

  return {
    BCM: 'bcm',
    OUT: outputMode,
    HIGH: 1,
    LOW: 0,
    setwarnings() {},
    setmode() {},
    setup(pin: number) {
      if (!pins.has(pin)) {
        const gpio = new GpioClass(pin, { mode: GpioClass.OUTPUT });
        gpio.digitalWrite(0);
        pins.set(pin, gpio);
      }
    },
    output(pin: number, value: number) {
      let gpio = pins.get(pin);
      if (!gpio) {
        gpio = new GpioClass(pin, { mode: GpioClass.OUTPUT });
        pins.set(pin, gpio);
      }
      const normalized: 0 | 1 = value === 0 ? 0 : 1;
      gpio.digitalWrite(normalized);
    },
    cleanup() {
      for (const gpio of pins.values()) {
        try {
          gpio.digitalWrite(0);
          if (typeof inputMode === 'number' && typeof gpio.mode === 'function') {
            gpio.mode(inputMode);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Failed to reset pigpio pin during cleanup: ${message}`);
        }
      }
      pins.clear();
    },
  };
}

function tryCreatePigpio(): GpioController | null {
  try {
    const { Gpio } = require('pigpio') as PigpioModule;
    if (typeof Gpio !== 'function') {
      throw new Error('pigpio did not export Gpio constructor');
    }
    return createPigpioFacade(Gpio);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'MODULE_NOT_FOUND') {
      console.warn('pigpio module not installed; skipping hardware-accelerated GPIO.');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`pigpio unavailable: ${message}`);
    }
    return null;
  }
}

function tryCreateOnoff(): GpioController | null {
  try {
    const { Gpio } = require('onoff') as typeof import('onoff');
    if (typeof Gpio !== 'function') {
      throw new Error('onoff did not export Gpio constructor');
    }
    if (!Gpio.accessible) {
      throw new Error('GPIO not accessible on this platform');
    }
    return createOnoffFacade(Gpio);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'MODULE_NOT_FOUND') {
      console.warn('onoff module not installed; GPIO sysfs driver unavailable.');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`onoff unavailable: ${message}`);
    }
    return null;
  }
}

export function createGpio(): GpioController {
  const pigpio = tryCreatePigpio();
  if (pigpio) {
    console.log('Using pigpio GPIO driver.');
    return pigpio;
  }

  const onoff = tryCreateOnoff();
  if (onoff) {
    console.log('Using onoff GPIO driver.');
    return onoff;
  }

  console.warn('Falling back to noop GPIO driver. Install pigpio or onoff for hardware control.');
  return new NoopGpio();
}
