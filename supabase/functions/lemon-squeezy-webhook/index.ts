// Supabase Edge Function: lemon-squeezy-webhook
// This function verifies incoming webhook events from Lemon Squeezy and updates the database.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const LEMON_SQUEEZY_SIGNING_SECRET = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SIGNING_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Initialize Supabase Client with the service role key to bypass Row Level Security (RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  // CORS Preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { 
      headers: { 
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      } 
    });
  }

  // Get Lemon Squeezy signature header
  const signature = req.headers.get("x-signature");
  if (!signature) {
    console.error("Webhook Error: Missing x-signature header");
    return new Response("Missing signature", { status: 401 });
  }

  // Read raw request body to verify signature
  const rawBody = await req.text();

  // Verify the signature using HMAC-SHA256
  const encoder = new TextEncoder();
  const keyBuf = encoder.encode(LEMON_SQUEEZY_SIGNING_SECRET);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBuf = hexToBytes(signature);
  const bodyBuf = encoder.encode(rawBody);
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBuf,
    bodyBuf
  );

  if (!isValid) {
    console.error("Webhook Error: Signature validation failed");
    return new Response("Invalid signature", { status: 401 });
  }

  // Parse webhook payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("Webhook Error: Failed to parse body JSON", err);
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventName = payload.meta?.event_name;
  const data = payload.data;

  console.log(`Processing Webhook Event: ${eventName}`);

  if (eventName === "order_created" || eventName === "subscription_created") {
    const attributes = data.attributes;
    // Retrieve the company_id passed through from the checkout URL
    const companyId = payload.meta?.custom_data?.company_id;
    const customerId = String(attributes.customer_id);
    const subscriptionId = String(data.id);
    const status = attributes.status || "active";
    
    console.log(`Order/Subscription Created for Company ID: ${companyId}, Subscription ID: ${subscriptionId}`);

    if (companyId) {
      const { error } = await supabase
        .from("companies")
        .update({
          subscription_level: "pro", // Upgrade to Pro
          subscription_status: status,
          lemon_squeezy_customer_id: customerId,
          lemon_squeezy_subscription_id: subscriptionId,
        })
        .eq("id", companyId);

      if (error) {
        console.error("Database Error updating company:", error);
        return new Response("Database error", { status: 500 });
      }
      console.log(`Successfully upgraded Company ID ${companyId} to Pro.`);
    } else {
      console.warn("Warning: Received subscription_created without custom_data.company_id");
    }
  } else if (eventName === "subscription_updated") {
    const attributes = data.attributes;
    const subscriptionId = String(data.id);
    const status = attributes.status;
    const endsAt = attributes.ends_at;

    console.log(`Subscription Updated: ${subscriptionId}. Status: ${status}, Ends At: ${endsAt}`);

    const { error } = await supabase
      .from("companies")
      .update({
        subscription_status: status,
        subscription_period_end: endsAt,
      })
      .eq("lemon_squeezy_subscription_id", subscriptionId);

    if (error) {
      console.error("Database Error updating subscription:", error);
      return new Response("Database error", { status: 500 });
    }
  } else if (eventName === "subscription_cancelled") {
    const attributes = data.attributes;
    const subscriptionId = String(data.id);
    const status = attributes.status; // typically 'cancelled'
    const endsAt = attributes.ends_at; // date when service actually expires

    console.log(`Subscription Cancelled: ${subscriptionId}. Expiration: ${endsAt}`);

    const { error } = await supabase
      .from("companies")
      .update({
        subscription_status: status,
        subscription_period_end: endsAt,
      })
      .eq("lemon_squeezy_subscription_id", subscriptionId);

    if (error) {
      console.error("Database Error cancelling subscription:", error);
      return new Response("Database error", { status: 500 });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// Helper: Convert hex signature string to bytes
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let c = 0; c < hex.length; c += 2) {
    bytes[c / 2] = parseInt(hex.substring(c, c + 2), 16);
  }
  return bytes;
}
