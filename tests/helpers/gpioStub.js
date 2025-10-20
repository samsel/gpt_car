'use strict';

class GpioStub {
  constructor() {
    this.BCM = 11;
    this.OUT = 0;
    this.HIGH = 1;
    this.LOW = 0;
    this.reset();
  }

  reset() {
    this.mode = null;
    this.warningsDisabled = false;
    this.setupCalls = new Map();
    this.outputs = new Map();
    this.cleaned = false;
    this.log = [];
  }

  setwarnings(flag) {
    this.warningsDisabled = !flag;
  }

  setmode(mode) {
    this.mode = mode;
  }

  setup(pin, mode) {
    this.setupCalls.set(pin, mode);
    this.outputs.set(pin, this.LOW);
  }

  output(pin, value) {
    this.outputs.set(pin, value);
    this.log.push(['output', pin, value]);
  }

  cleanup() {
    this.cleaned = true;
  }
}

module.exports = { GpioStub };
