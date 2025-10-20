declare module 'ngrok' {
  type Protocol = 'http' | 'https' | 'tcp' | 'tls';

  interface ConnectOptions {
    addr: number | string;
    proto?: Protocol;
    authtoken?: string;
    region?: string;
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
