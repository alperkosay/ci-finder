/**
 * In-memory S3 emulator implementing the subset of the REST API the driver uses. It is plugged in
 * through the driver's `fetch` option, so tests exercise the real request building and XML parsing.
 */
interface Obj {
  body: Uint8Array;
  mtime: number;
  type: string;
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function fakeS3(bucket = "test") {
  const objects = new Map<string, Obj>();
  const uploads = new Map<string, Map<number, Uint8Array>>();
  const requests: { method: string; url: string }[] = [];
  let uploadSeq = 0;

  const xml = (body: string, status = 200) =>
    new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { status, headers: { "content-type": "application/xml" } });
  const notFound = () => xml("<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>", 404);

  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    requests.push({ method, url: url.toString() });
    if (!headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 ")) return xml("<Error><Code>AccessDenied</Code></Error>", 403);

    const [, b, ...rest] = url.pathname.split("/");
    if (decodeURIComponent(b ?? "") !== bucket) return xml("<Error><Code>NoSuchBucket</Code></Error>", 404);
    const key = rest.map(decodeURIComponent).join("/");
    const q = url.searchParams;
    const body = init.body ? new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()) : new Uint8Array();

    if (method === "GET" && !key && q.get("list-type") === "2") {
      const prefix = q.get("prefix") ?? "";
      const delimiter = q.get("delimiter");
      const max = Number(q.get("max-keys") ?? 1000);
      const start = Number(q.get("continuation-token") ?? 0);
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const items: ({ key: string } | { prefix: string })[] = [];
      const seen = new Set<string>();
      for (const k of keys) {
        const restKey = k.slice(prefix.length);
        const i = delimiter ? restKey.indexOf(delimiter) : -1;
        if (i >= 0) {
          const p = prefix + restKey.slice(0, i + 1);
          if (!seen.has(p)) {
            seen.add(p);
            items.push({ prefix: p });
          }
        } else items.push({ key: k });
      }
      const page = items.slice(start, start + max);
      const truncated = start + max < items.length;
      return xml(
        `<ListBucketResult><Prefix>${xmlEscape(prefix)}</Prefix><IsTruncated>${truncated}</IsTruncated>` +
          (truncated ? `<NextContinuationToken>${start + max}</NextContinuationToken>` : "") +
          page
            .map((it) =>
              "key" in it
                ? `<Contents><Key>${xmlEscape(it.key)}</Key><LastModified>${new Date(objects.get(it.key)!.mtime).toISOString()}</LastModified><Size>${objects.get(it.key)!.body.length}</Size></Contents>`
                : `<CommonPrefixes><Prefix>${xmlEscape(it.prefix)}</Prefix></CommonPrefixes>`,
            )
            .join("") +
          "</ListBucketResult>",
      );
    }

    if (method === "POST" && q.has("uploads")) {
      const id = `up-${++uploadSeq}`;
      uploads.set(id, new Map());
      return xml(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (method === "PUT" && q.has("uploadId")) {
      const parts = uploads.get(q.get("uploadId")!);
      if (!parts) return xml("<Error><Code>NoSuchUpload</Code></Error>", 404);
      parts.set(Number(q.get("partNumber")), body);
      return new Response(null, { headers: { etag: `"etag-${q.get("partNumber")}"` } });
    }
    if (method === "GET" && q.has("uploadId")) {
      const parts = uploads.get(q.get("uploadId")!);
      if (!parts) return xml("<Error><Code>NoSuchUpload</Code></Error>", 404);
      return xml(
        `<ListPartsResult><IsTruncated>false</IsTruncated>${[...parts.keys()].map((n) => `<Part><PartNumber>${n}</PartNumber><ETag>&quot;etag-${n}&quot;</ETag></Part>`).join("")}</ListPartsResult>`,
      );
    }
    if (method === "POST" && q.has("uploadId")) {
      const parts = uploads.get(q.get("uploadId")!);
      if (!parts) return xml("<Error><Code>NoSuchUpload</Code></Error>", 404);
      const order = [...new TextDecoder().decode(body).matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) => Number(m[1]));
      const chunks = order.map((n) => parts.get(n)!);
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        all.set(c, o);
        o += c.length;
      }
      objects.set(key, { body: all, mtime: Date.now(), type: "" });
      uploads.delete(q.get("uploadId")!);
      return xml("<CompleteMultipartUploadResult></CompleteMultipartUploadResult>");
    }
    if (method === "DELETE" && q.has("uploadId")) {
      uploads.delete(q.get("uploadId")!);
      return new Response(null, { status: 204 });
    }

    if (method === "PUT") {
      const source = headers.get("x-amz-copy-source");
      if (source) {
        const srcKey = source.split("/").slice(2).map(decodeURIComponent).join("/");
        const src = objects.get(srcKey);
        if (!src) return notFound();
        objects.set(key, { ...src, mtime: Date.now() });
        return xml("<CopyObjectResult></CopyObjectResult>");
      }
      objects.set(key, { body, mtime: Date.now(), type: headers.get("content-type") ?? "" });
      return new Response(null, { status: 200, headers: { etag: '"x"' } });
    }
    if (method === "HEAD" || method === "GET") {
      const obj = objects.get(key);
      if (!obj) return method === "HEAD" ? new Response(null, { status: 404 }) : notFound();
      const h = { "content-length": String(obj.body.length), "last-modified": new Date(obj.mtime).toUTCString() };
      if (method === "HEAD") return new Response(null, { headers: h });
      const range = /bytes=(\d+)-(\d+)/.exec(headers.get("range") ?? "");
      if (range) return new Response(obj.body.slice(Number(range[1]), Number(range[2]) + 1) as BodyInit, { status: 206 });
      return new Response(obj.body as BodyInit, { headers: h });
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return xml("<Error><Code>NotImplemented</Code></Error>", 501);
  };

  return { fetch: fetchImpl as typeof fetch, objects, uploads, requests };
}
