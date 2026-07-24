// Supabase Edge Function: create-checkout-session
// Generates a Stripe Checkout Session URL using the server-side STRIPE_SECRET_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }

  try {
    const { priceId, companyId, email, origin } = await req.json();

    if (!priceId) {
      return new Response(JSON.stringify({ error: "Missing priceId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const appOrigin = origin || "https://constructquote.com";
    const successUrl = appOrigin + "?checkout=success";
    const cancelUrl = appOrigin + "?checkout=cancelled";

    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
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
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      });
    } else {
      const errData = await res.json();
      console.error("Stripe API Error", errData);
      return new Response(JSON.stringify({ error: errData }), {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      });
    }
  } catch (err: any) {
    console.error("Function Catch Error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      }
    });
  }
});
