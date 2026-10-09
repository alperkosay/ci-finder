import { createUploadsRoute } from "@thefinder/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves `<project root>/uploads/**` at `/uploads/**`, including files uploaded after the build. */
export const { GET, HEAD } = createUploadsRoute();
