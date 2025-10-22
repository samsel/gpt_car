declare module 'ngrok' {
  type Protocol = 'http' | 'tcp' | 'tls';

  interface ConnectOptions {
    addr: number | string;
    proto?: Protocol;
    authtoken?: string;
    region?: 'us' | 'eu' | 'ap' | 'au' | 'sa' | 'jp' | 'in';
    subdomain?: string;
    hostname?: string;
    headers?: Record<string, string>;
    basic_auth?: string | string[];
  }

  interface Ngrok {
    connect(opts: ConnectOptions | string): Promise<string>;
    disconnect(target?: string): Promise<void>;
    kill(): Promise<void>;
    authtoken(token: string): Promise<void>;
  }

  const ngrok: Ngrok & {
    ConnectOptions: ConnectOptions;
  };

  export type { ConnectOptions };
  export default ngrok;
}

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
