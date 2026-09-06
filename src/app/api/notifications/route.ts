import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireUser } from "@/lib/require-user";

export async function GET(request: Request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("read", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notifications: data });
  } catch (err) {
    console.error("[Notifications GET] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const { id, markAllRead } = body as {
      id?: string;
      markAllRead?: boolean;
    };

    const supabase = createServiceClient();

    if (markAllRead) {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("read", false);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    if (id) {
      const { data, error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ notification: data });
    }

    return NextResponse.json(
      { error: "Provide id or markAllRead" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[Notifications PATCH] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
