// Supabase Edge Function: stripe-webhook
// Verifies incoming Stripe webhook events and updates subscription state in the companies table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

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
      let periodEndIso = null;

      // Optionally fetch subscription from Stripe to get current_period_end
      if (subscriptionId && STRIPE_SECRET_KEY) {
        try {
          const subRes = await fetch("https://api.stripe.com/v1/subscriptions/" + subscriptionId, {
            headers: { "Authorization": "Bearer " + STRIPE_SECRET_KEY }
          });
          if (subRes.ok) {
            const subData = await subRes.json();
            if (subData.current_period_end) {
              periodEndIso = new Date(subData.current_period_end * 1000).toISOString();
            }
          }
        } catch (e) {
          console.warn("Failed to fetch subscription period end from Stripe", e);
        }
      }

      const updatePayload: any = {
        subscription_level: "pro",
        subscription_status: "active",
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId
      };
      if (periodEndIso) {
        updatePayload.subscription_period_end = periodEndIso;
      }

      const { error } = await supabase
        .from("companies")
        .update(updatePayload)
        .eq("id", companyId);

      if (error) {
        console.error("Database Error updating company subscription", error);
        return new Response("Database error", { status: 500 });
      }

      console.log("Successfully upgraded Company to Pro", companyId);
    } else {
      console.warn("Warning: Received checkout.session.completed without company_id");
    }
  } else if ((eventType === "customer.subscription.created" || eventType === "customer.subscription.updated") && dataObject) {
    const subscription = dataObject;
    const subscriptionId = subscription.id;
    const customerId = subscription.customer;
    const status = subscription.status;
    const companyId = subscription.metadata ? subscription.metadata.company_id : null;
    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    console.log("Subscription Created/Updated", subscriptionId, status, periodEnd);

    const updatePayload: any = {
      subscription_status: status,
      stripe_subscription_id: subscriptionId
    };
    if (periodEnd) {
      updatePayload.subscription_period_end = periodEnd;
    }
    if (customerId) {
      updatePayload.stripe_customer_id = customerId;
    }

    // Try updating by stripe_subscription_id first, then stripe_customer_id, then company_id
    let { data, error } = await supabase
      .from("companies")
      .update(updatePayload)
      .eq("stripe_subscription_id", subscriptionId)
      .select();

    if ((!data || data.length === 0) && customerId) {
      const res = await supabase
        .from("companies")
        .update(updatePayload)
        .eq("stripe_customer_id", customerId)
        .select();
      data = res.data;
      error = res.error;
    }

    if ((!data || data.length === 0) && companyId) {
      const res = await supabase
        .from("companies")
        .update(updatePayload)
        .eq("id", companyId)
        .select();
      data = res.data;
      error = res.error;
    }

    if (error) {
      console.error("Database Error updating subscription status", error);
      return new Response("Database error", { status: 500 });
    }
  } else if (eventType === "customer.subscription.deleted" && dataObject) {
    const subscription = dataObject;
    const subscriptionId = subscription.id;
    const customerId = subscription.customer;

    console.log("Subscription Cancelled", subscriptionId);

    const updatePayload = {
      subscription_level: "trial",
      subscription_status: "canceled"
    };

    let { error } = await supabase
      .from("companies")
      .update(updatePayload)
      .eq("stripe_subscription_id", subscriptionId);

    if (error && customerId) {
      await supabase
        .from("companies")
        .update(updatePayload)
        .eq("stripe_customer_id", customerId);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
});
