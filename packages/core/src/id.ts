import { CiFinderError } from "./errors";
import { normalizePath } from "./path";
import type { VolumePath } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Entry ids are "<volume>_<base64url(path)>". They are stable, URL safe and reversible. */
export function encodeId(volume: string, path: VolumePath): string {
  return `${volume}_${base64UrlEncode(encoder.encode(path))}`;
}

export function decodeId(id: unknown): { volume: string; path: VolumePath } {
  if (typeof id !== "string" || id.length > 4096) throw new CiFinderError("BAD_REQUEST", "Invalid id");
  const i = id.indexOf("_");
  if (i <= 0) throw new CiFinderError("BAD_REQUEST", "Invalid id");
  let raw: string;
  try {
    raw = decoder.decode(base64UrlDecode(id.slice(i + 1)));
  } catch {
    throw new CiFinderError("BAD_REQUEST", "Invalid id");
  }
  return { volume: id.slice(0, i), path: normalizePath(raw) };
}
