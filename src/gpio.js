'use strict';

/**
 * Lightweight GPIO facade. The implementation defers to a runtime-provided
 * module if one is available (such as `rpio` or `onoff`). The default export is
 * a no-op shim suitable for local development and unit testing.
 */
class NoopGpio {
  constructor() {
    this.BCM = 11;
    this.OUT = 0;
    this.HIGH = 1;
    this.LOW = 0;
    this._outputs = new Map();
  }

  setwarnings(flag) {
    void flag;
  }

  setmode(mode) {
    this._mode = mode;
  }

  setup(pin, mode) {
    this._outputs.set(pin, this.LOW);
    this._modes = this._modes || new Map();
    this._modes.set(pin, mode);
  }

  output(pin, value) {
    this._outputs.set(pin, value);
  }

  cleanup() {
    this._outputs.clear();
  }
}

let gpio = new NoopGpio();

module.exports = gpio;
