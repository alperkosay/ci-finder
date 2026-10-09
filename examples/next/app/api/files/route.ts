import { createNextRoutes } from "@thefinder/next";
import { finder } from "@/lib/finder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = createNextRoutes(finder);
