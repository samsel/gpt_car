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

export function createGpio(): GpioController {
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
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to initialize onoff GPIO, using noop implementation: ${message}`);
    return new NoopGpio();
  }
}
