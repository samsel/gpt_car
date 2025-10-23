declare module 'pigpio' {
  interface GpioOptions {
    mode?: number;
  }

  export class Gpio {
    static readonly INPUT: number;
    static readonly OUTPUT: number;

    constructor(pin: number, options?: GpioOptions);

    digitalWrite(value: 0 | 1): void;
    mode(mode: number): void;
  }

  export { GpioOptions };
}
