import "server-only";
import { Socket } from "node:net";
import { URL } from "node:url";

type RedisValue = string | number | null | RedisValue[];

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0";
const DEFAULT_TIMEOUT_MS = 800;

function encodeCommand(parts: Array<string | number>): string {
  return `*${parts.length}\r\n${parts
    .map((part) => {
      const value = String(part);
      return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
    })
    .join("")}`;
}

function parseRedisUrl(raw: string) {
  const url = new URL(raw);
  return {
    host: url.hostname || "127.0.0.1",
    port: url.port ? Number(url.port) : 6379,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
  };
}

class RespParser {
  private offset = 0;

  constructor(private readonly text: string) {}

  parse(): RedisValue {
    const type = this.text[this.offset++];
    if (type === "+") return this.readLine();
    if (type === "-") throw new Error(this.readLine());
    if (type === ":") return Number(this.readLine());
    if (type === "$") {
      const length = Number(this.readLine());
      if (length < 0) return null;
      const value = this.text.slice(this.offset, this.offset + length);
      this.offset += length + 2;
      return value;
    }
    if (type === "*") {
      const length = Number(this.readLine());
      if (length < 0) return null;
      const values: RedisValue[] = [];
      for (let i = 0; i < length; i += 1) {
        values.push(this.parse());
      }
      return values;
    }
    throw new Error("Unsupported Redis response");
  }

  parseAll(): RedisValue {
    let value: RedisValue = null;
    while (this.offset < this.text.length) {
      value = this.parse();
    }
    return value;
  }

  private readLine(): string {
    const end = this.text.indexOf("\r\n", this.offset);
    if (end < 0) throw new Error("Invalid Redis response");
    const line = this.text.slice(this.offset, end);
    this.offset = end + 2;
    return line;
  }
}

export async function redisCommand(
  parts: Array<string | number>,
): Promise<RedisValue> {
  const config = parseRedisUrl(process.env.CACHE_REDIS_URL ?? DEFAULT_REDIS_URL);
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Redis command timed out"));
    }, DEFAULT_TIMEOUT_MS);

    function finish(error: Error | null, value?: RedisValue) {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value ?? null);
    }

    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      try {
        finish(null, new RespParser(Buffer.concat(chunks).toString("utf8")).parseAll());
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Redis parse failed"));
      }
    });
    socket.connect(config.port, config.host, () => {
      const commands: string[] = [];
      if (config.password) {
        commands.push(encodeCommand(["AUTH", config.password]));
      }
      if (config.db > 0) {
        commands.push(encodeCommand(["SELECT", config.db]));
      }
      commands.push(encodeCommand(parts));
      socket.end(commands.join(""));
    });
  });
}
