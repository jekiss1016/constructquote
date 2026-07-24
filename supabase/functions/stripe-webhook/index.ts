// Supabase Edge Function: stripe-webhook
// Verifies incoming Stripe webhook events and updates subscription state in the companies table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Initialize Supabase client with service role key to bypass RLS
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  // CORS Preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }

  const rawBody = await req.text();
  let event;

  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error("Webhook Error: Invalid JSON body", err);
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventType = event.type;
  const dataObject = event.data ? event.data.object : null;

  console.log("Processing Stripe Webhook Event", eventType);

  if (eventType === "checkout.session.completed" && dataObject) {
    const session = dataObject;
    const companyId = session.client_reference_id || (session.metadata ? session.metadata.company_id : null);
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    console.log("Checkout Completed", companyId, customerId, subscriptionId);

    if (companyId) {
      const { error } = await supabase
        .from("companies")
        .update({
          subscription_level: "pro",
          subscription_status: "active",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId
        })
        .eq("id", companyId);

      if (error) {
        console.error("Database Error updating company subscription", error);
        return new Response("Database error", { status: 500 });
      }

      console.log("Successfully upgraded Company to Pro", companyId);
    } else {
      console.warn("Warning: Received checkout.session.completed without company_id");
    }
  } else if (eventType === "customer.subscription.updated" && dataObject) {
    const subscription = dataObject;
    const subscriptionId = subscription.id;
    const status = subscription.status;
    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    console.log("Subscription Updated", subscriptionId, status);

    const updatePayload: any = {
      subscription_status: status
    };
    if (periodEnd) {
      updatePayload.subscription_period_end = periodEnd;
    }

    const { error } = await supabase
      .from("companies")
      .update(updatePayload)
      .eq("stripe_subscription_id", subscriptionId);

    if (error) {
      console.error("Database Error updating subscription status", error);
      return new Response("Database error", { status: 500 });
    }
  } else if (eventType === "customer.subscription.deleted" && dataObject) {
    const subscription = dataObject;
    const subscriptionId = subscription.id;

    console.log("Subscription Cancelled", subscriptionId);

    const { error } = await supabase
      .from("companies")
      .update({
        subscription_level: "trial",
        subscription_status: "canceled"
      })
      .eq("stripe_subscription_id", subscriptionId);

    if (error) {
      console.error("Database Error cancelling subscription", error);
      return new Response("Database error", { status: 500 });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
});
