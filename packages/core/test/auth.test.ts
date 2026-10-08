import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CiFinderError, createCiFinder, type CiFinder } from "../src/index";
import { localDriver } from "../src/drivers/local";
import { api, id, tempDir } from "./helpers";

let dir: string;
let cleanup: () => Promise<void>;
let finder: CiFinder;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  await writeFile(join(dir, "a.txt"), "a");
  // Role comes from a header here; real apps read their session cookie.
  finder = createCiFinder({
    volumes: [{ id: "local", driver: localDriver({ root: dir }) }],
    authorize: ({ request }) => {
      const role = request.headers.get("x-role");
      if (!role) throw new CiFinderError("UNAUTHORIZED", "Sign in first");
      return role === "viewer" ? { readOnly: true } : true;
    },
  });
});
afterEach(() => cleanup());

const as = (role?: string) => api(finder, role);

it("rejects anonymous requests with 401", async () => {
  const r = await as().post("ls", { id: id("local", "/") });
  expect(r.status).toBe(401);
  expect(r.body.error.code).toBe("UNAUTHORIZED");
});

it("viewers can read but not write", async () => {
  const viewer = as("viewer");
  const { volumes } = await viewer.ok("init");
  expect(volumes[0].readOnly).toBe(true);
  expect(volumes[0].root.write).toBe(false);
  expect((await viewer.ok("ls", { id: id("local", "/") })).entries.map((e: any) => e.name)).toEqual(["a.txt"]);
  expect((await viewer.ok("get", { id: id("local", "/a.txt") })).content).toBe("a");
  expect(await viewer.fail("mkdir", { id: id("local", "/"), name: "x" })).toBe("READ_ONLY");
  expect(await viewer.fail("rm", { ids: [id("local", "/a.txt")] })).toBe("READ_ONLY");
  expect(await viewer.fail("put", { id: id("local", "/a.txt"), content: "b" })).toBe("READ_ONLY");
});

it("admins are unaffected by viewers in between", async () => {
  await as("viewer").ok("init");
  const admin = as("admin");
  expect((await admin.ok("init")).volumes[0].readOnly).toBe(false);
  await admin.ok("mkdir", { id: id("local", "/"), name: "yeni" });
  await as("viewer").fail("mkdir", { id: id("local", "/"), name: "yeni2" });
  await admin.ok("mkdir", { id: id("local", "/"), name: "yeni2" });
});
