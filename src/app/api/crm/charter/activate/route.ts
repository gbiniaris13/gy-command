import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contactId, charter_start_date } = body as {
      contactId: string;
      charter_start_date: string;
    };

    if (!contactId || !charter_start_date) {
      return NextResponse.json(
        { error: "contactId and charter_start_date are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Fetch contact to get charter_end_date
    const { data: contact, error: fetchErr } = await supabase
      .from("contacts")
      .select("charter_end_date, first_name, last_name")
      .eq("id", contactId)
      .single();

    if (fetchErr || !contact) {
      return NextResponse.json(
        { error: "Contact not found" },
        { status: 404 }
      );
    }

    const startDate = new Date(charter_start_date);
    const endDateStr = contact.charter_end_date;
    const endDate = endDateStr ? new Date(endDateStr) : null;

    function addDays(date: Date, days: number): string {
      const d = new Date(date);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    }

    const reminders: {
      contact_id: string;
      reminder_type: string;
      reminder_date: string;
      description: string;
      completed: boolean;
      snoozed_until: null;
    }[] = [
      {
        contact_id: contactId,
        reminder_type: "preference_sheet",
        reminder_date: addDays(startDate, -60),
        description: "Send Preference Sheet to client",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "balance_check",
        reminder_date: addDays(startDate, -45),
        description: "Balance payment check",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "captain_call",
        reminder_date: addDays(startDate, -30),
        description: "Video call with captain",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "dietary",
        reminder_date: addDays(startDate, -30),
        description: "Confirm dietary requirements",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "final_balance",
        reminder_date: addDays(startDate, -21),
        description: "Final balance due",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "itinerary",
        reminder_date: addDays(startDate, -14),
        description: "Finalize itinerary",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "transfer",
        reminder_date: addDays(startDate, -14),
        description: "Arrange airport transfer",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "final_check",
        reminder_date: addDays(startDate, -7),
        description: "Final check -- all details confirmed",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "welcome",
        reminder_date: addDays(startDate, -3),
        description: "Send welcome message to client",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "charter_start",
        reminder_date: addDays(startDate, 0),
        description: "Charter begins -- bon voyage!",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "charter_end",
        reminder_date: endDate ? addDays(endDate, 0) : addDays(startDate, 7),
        description: "Charter complete -- follow up",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "thank_you",
        reminder_date: endDate ? addDays(endDate, 1) : addDays(startDate, 8),
        description: "Send thank you email",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "check_in",
        reminder_date: endDate ? addDays(endDate, 30) : addDays(startDate, 37),
        description: "Check-in email -- how was the trip?",
        completed: false,
        snoozed_until: null,
      },
      {
        contact_id: contactId,
        reminder_type: "referral",
        reminder_date: endDate ? addDays(endDate, 90) : addDays(startDate, 97),
        description: "Referral ask -- know anyone who loves yachting?",
        completed: false,
        snoozed_until: null,
      },
    ];

    const { data, error } = await supabase
      .from("charter_reminders")
      .insert(reminders)
      .select();

    if (error) {
      console.error("[Charter Activate] Insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update contact charter_start_date
    await supabase
      .from("contacts")
      .update({ charter_start_date })
      .eq("id", contactId);

    return NextResponse.json({
      success: true,
      reminders_created: data?.length ?? 0,
    });
  } catch (err) {
    console.error("[Charter Activate] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
