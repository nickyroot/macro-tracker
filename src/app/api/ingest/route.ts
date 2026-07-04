import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { runIngest } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hit daily by Vercel Cron (see vercel.json). Vercel sends
// `Authorization: Bearer $CRON_SECRET` automatically when the env var is set.
// `?full=1` refetches complete history — only needed for the first backfill.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const full = req.nextUrl.searchParams.get("full") === "1";
  const result = await runIngest({ full });
  revalidatePath("/");
  return Response.json(result, { status: result.status === "ok" ? 200 : 500 });
}
