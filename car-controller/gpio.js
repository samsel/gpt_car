import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

class NoopGpio {
  constructor() {
    this.BCM = 11;
    this.OUT = 0;
    this.HIGH = 1;
    this.LOW = 0;
    this.state = new Map();
  }

  setwarnings() {}

  setmode() {}

  setup(pin) {
    this.state.set(pin, this.LOW);
  }

  output(pin, value) {
    this.state.set(pin, value);
  }

  cleanup() {
    this.state.clear();
  }
}

function createPigpioFacade(GpioClass) {
  const pins = new Map();
  const outputMode = typeof GpioClass.OUTPUT === 'number' ? GpioClass.OUTPUT : 1;
  const inputMode = typeof GpioClass.INPUT === 'number' ? GpioClass.INPUT : undefined;

  return {
    BCM: 'bcm',
    OUT: outputMode,
    HIGH: 1,
    LOW: 0,
    setwarnings() {},
    setmode() {},
    setup(pin) {
      if (!pins.has(pin)) {
        const gpio = new GpioClass(pin, { mode: GpioClass.OUTPUT });
        gpio.digitalWrite(0);
        pins.set(pin, gpio);
      }
    },
    output(pin, value) {
      let gpio = pins.get(pin);
      if (!gpio) {
        gpio = new GpioClass(pin, { mode: GpioClass.OUTPUT });
        pins.set(pin, gpio);
      }
      const normalized = value === 0 ? 0 : 1;
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

function tryCreatePigpio() {
  try {
    const { Gpio } = require('pigpio');
    if (typeof Gpio !== 'function') {
      throw new Error('pigpio did not export Gpio constructor');
    }
    return createPigpioFacade(Gpio);
  } catch (error) {
    const err = error;
    if (err && typeof err === 'object' && 'code' in err && err.code === 'MODULE_NOT_FOUND') {
      console.warn('pigpio module not installed; skipping hardware-accelerated GPIO.');
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`pigpio unavailable: ${message}`);
    }
    return null;
  }
}

export function createGpio() {
  const pigpio = tryCreatePigpio();
  if (pigpio) {
    console.log('Using pigpio GPIO driver.');
    return pigpio;
  }

  console.warn('pigpio module not available; falling back to noop GPIO driver.');
  return new NoopGpio();
}

export { NoopGpio };
