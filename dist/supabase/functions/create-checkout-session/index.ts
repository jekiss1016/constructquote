// Supabase Edge Function: create-checkout-session
// Generates Stripe Checkout Sessions & Customer Portal Sessions securely using server-side STRIPE_SECRET_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  // CORS Preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    const body = await req.json();
    const { action, priceId, companyId, customerId, email, origin } = body;

    const appOrigin = origin || "https://constructquote.com";

    // Action: Customer Billing Portal Session
    if (action === "portal") {
      let targetCustomerId = customerId;

      // Fallback: If customerId is not cached in client profile, look it up in DB via companyId
      if (!targetCustomerId && companyId) {
        console.log("Portal Session: Looking up stripe_customer_id for companyId", companyId);
        const { data: co, error: coErr } = await supabase
          .from("companies")
          .select("stripe_customer_id")
          .eq("id", companyId)
          .single();

        if (co && co.stripe_customer_id) {
          targetCustomerId = co.stripe_customer_id;
        } else if (coErr) {
          console.error("Portal DB Lookup Error:", coErr);
        }
      }

      if (!targetCustomerId) {
        return new Response(JSON.stringify({ error: "Missing customerId or company subscription not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const portalParams = new URLSearchParams();
      portalParams.append("customer", targetCustomerId);
      portalParams.append("return_url", appOrigin);

      const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + STRIPE_SECRET_KEY,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: portalParams.toString()
      });

      if (portalRes.ok) {
        const portalSession = await portalRes.json();
        return new Response(JSON.stringify({ url: portalSession.url }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } else {
        const errData = await portalRes.json();
        console.error("Stripe Portal API Error", errData);
        return new Response(JSON.stringify({ error: errData }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Default Action: Checkout Session
    if (!priceId) {
      return new Response(JSON.stringify({ error: "Missing priceId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const successUrl = appOrigin + "?checkout=success";
    const cancelUrl = appOrigin + "?checkout=cancelled";

    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("allow_promotion_codes", "true");
    if (email) params.append("customer_email", email);
    if (companyId) params.append("client_reference_id", companyId);
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);

    // Custom metadata with managed_payments flag
    if (companyId) {
      params.append("metadata[company_id]", companyId);
      params.append("subscription_data[metadata][company_id]", companyId);
    }
    params.append("metadata[managed_payments]", "true");
    params.append("subscription_data[metadata][managed_payments]", "true");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    if (res.ok) {
      const session = await res.json();
      return new Response(JSON.stringify({ url: session.url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } else {
      const errData = await res.json();
      console.error("Stripe API Error", errData);
      return new Response(JSON.stringify({ error: errData }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } catch (err: any) {
    console.error("Function Catch Error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
