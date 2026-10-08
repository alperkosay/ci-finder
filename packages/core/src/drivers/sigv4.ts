/**
 * Minimal AWS Signature Version 4 implementation on top of Web Crypto, so the S3 driver runs on
 * Node.js, Bun, Deno and edge runtimes without the AWS SDK.
 */

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, encoder.encode(data)));
}

/** RFC 3986 encoding as required by SigV4 (encodeURIComponent leaves !'()* alone). */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Encodes an S3 key for the URL path: every segment encoded, slashes kept. */
export function encodeKey(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

export function buildQuery(query: Record<string, string | undefined>): string {
  return Object.entries(query)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Re-encodes an already-built query string into canonical form (sorted, strict encoding). */
function canonicalQuery(search: string): string {
  if (!search || search === "?") return "";
  const pairs = search
    .replace(/^\?/, "")
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      const v = i < 0 ? "" : decodeURIComponent(pair.slice(i + 1));
      return [uriEncode(k), uriEncode(v)] as const;
    });
  pairs.sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function amzDate(date: Date): { stamp: string; day: string } {
  const stamp = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { stamp, day: stamp.slice(0, 8) };
}

const keyCache = new Map<string, Uint8Array>();

async function signingKey(secret: string, day: string, region: string, service: string): Promise<Uint8Array> {
  const cacheKey = `${secret}|${day}|${region}|${service}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const kDate = await hmac(encoder.encode("AWS4" + secret), day);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  if (keyCache.size > 32) keyCache.clear();
  keyCache.set(cacheKey, kSigning);
  return kSigning;
}

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign and send. Host is added automatically. */
  headers?: Record<string, string>;
  payloadHash?: string;
  region: string;
  service?: string;
  credentials: Credentials;
  date?: Date;
}

/** Returns the full header set (including Authorization) for a signed request. */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const { url, region, credentials } = input;
  const service = input.service ?? "s3";
  const { stamp, day } = amzDate(input.date ?? new Date());
  const payloadHash = input.payloadHash ?? UNSIGNED_PAYLOAD;

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  headers["host"] = url.host;
  headers["x-amz-date"] = stamp;
  headers["x-amz-content-sha256"] = payloadHash;
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery(url.search),
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = toHex(await hmac(await signingKey(credentials.secretAccessKey, day, region, service), stringToSign));

  const out: Record<string, string> = { ...headers };
  delete out["host"]; // fetch derives it from the URL and refuses to set it manually
  out["authorization"] = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

export interface PresignInput {
  method?: string;
  url: URL;
  region: string;
  service?: string;
  credentials: Credentials;
  /** Seconds the URL stays valid. Max 604800 (7 days). */
  expiresIn: number;
  date?: Date;
}

/** Query-string authentication (presigned URL). Only the host header is signed. */
export async function presignUrl(input: PresignInput): Promise<string> {
  const { url, region, credentials } = input;
  const service = input.service ?? "s3";
  const { stamp, day } = amzDate(input.date ?? new Date());
  const scope = `${day}/${region}/${service}/aws4_request`;

  const params: Record<string, string> = {};
  for (const pair of url.search.replace(/^\?/, "").split("&").filter(Boolean)) {
    const i = pair.indexOf("=");
    params[decodeURIComponent(i < 0 ? pair : pair.slice(0, i))] = i < 0 ? "" : decodeURIComponent(pair.slice(i + 1));
  }
  params["X-Amz-Algorithm"] = "AWS4-HMAC-SHA256";
  params["X-Amz-Credential"] = `${credentials.accessKeyId}/${scope}`;
  params["X-Amz-Date"] = stamp;
  params["X-Amz-Expires"] = String(Math.min(Math.max(1, Math.floor(input.expiresIn)), 604800));
  params["X-Amz-SignedHeaders"] = "host";
  if (credentials.sessionToken) params["X-Amz-Security-Token"] = credentials.sessionToken;

  const query = buildQuery(params);
  const canonicalRequest = [(input.method ?? "GET").toUpperCase(), url.pathname || "/", query, `host:${url.host}\n`, "host", UNSIGNED_PAYLOAD].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = toHex(await hmac(await signingKey(credentials.secretAccessKey, day, region, service), stringToSign));
  return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${signature}`;
}
