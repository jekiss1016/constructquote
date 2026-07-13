-- SQL Migration for Quote Emailing Feature
-- Run these statements in the Supabase SQL Editor.

-- ==================== 1. SCHEMA UPDATES ====================

-- Add email body defaults to settings and customers
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS quote_email_body_default text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS quote_email_body_default text;

-- Create quote email logs table
CREATE TABLE IF NOT EXISTS public.quote_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE NOT NULL,
  sent_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  to_email text NOT NULL,
  cc_emails text, -- Comma-separated string of CC'd emails
  quote_version integer NOT NULL
);

-- ==================== 2. ROW LEVEL SECURITY (RLS) ====================

ALTER TABLE public.quote_email_logs ENABLE ROW LEVEL SECURITY;

-- Select policy
DROP POLICY IF EXISTS "Select quote_email_logs based on company" ON public.quote_email_logs;
CREATE POLICY "Select quote_email_logs based on company" ON public.quote_email_logs
  FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_sysadmin());

-- Insert policy
DROP POLICY IF EXISTS "Insert quote_email_logs based on company write access" ON public.quote_email_logs;
CREATE POLICY "Insert quote_email_logs based on company write access" ON public.quote_email_logs
  FOR INSERT WITH CHECK ((company_id = public.get_user_company_id() AND public.has_write_access()) OR public.is_sysadmin());

-- ==================== 3. EMAIL DISPATCH RPC FUNCTION ====================

CREATE OR REPLACE FUNCTION public.send_quote_email(
  p_company_name text,
  p_company_email text,
  p_to_email text,
  p_cc_emails text[],
  p_subject text,
  p_msg text
) RETURNS jsonb SECURITY DEFINER AS $$
DECLARE
  brevo_key text;
  resend_key text;
  resp_status integer;
  resp_content text;
  cc_brevo jsonb;
BEGIN
  -- Fetch API keys from system config
  SELECT value INTO brevo_key FROM public.system_config WHERE key = 'brevo_api_key';
  SELECT value INTO resend_key FROM public.system_config WHERE key = 'resend_api_key';

  IF brevo_key IS NULL AND resend_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Neither Brevo nor Resend API Key is configured in public.system_config.');
  END IF;

  -- 1. Try Brevo integration first if Brevo API key is available
  IF brevo_key IS NOT NULL AND brevo_key <> '' THEN
    -- Convert CC text[] array to Brevo JSON array: [{"email": "colleague@domain.com"}, ...]
    IF p_cc_emails IS NOT NULL AND array_length(p_cc_emails, 1) > 0 THEN
      SELECT jsonb_agg(jsonb_build_object('email', email)) INTO cc_brevo
      FROM unnest(p_cc_emails) AS email;
    ELSE
      cc_brevo := NULL;
    END IF;

    SELECT status, content INTO resp_status, resp_content
    FROM http((
      'POST',
      'https://api.brevo.com/v3/smtp/email',
      ARRAY[
        http_header('api-key', brevo_key),
        http_header('Content-Type', 'application/json')
      ],
      'application/json',
      jsonb_build_object(
        'sender', jsonb_build_object('name', p_company_name, 'email', 'Quotes@mybidbook.com'),
        'to', jsonb_build_array(jsonb_build_object('email', p_to_email)),
        'cc', cc_brevo,
        'bcc', jsonb_build_array(jsonb_build_object('email', p_company_email)),
        'replyTo', jsonb_build_object('email', p_company_email),
        'subject', p_subject,
        'htmlContent', '<div style="font-family: sans-serif; white-space: pre-wrap; font-size: 15px; line-height: 1.6; color: #334155;">' || p_msg || '</div>'
      )::text
    )::http_request);

    IF resp_status >= 200 AND resp_status < 300 THEN
      RETURN jsonb_build_object('success', true, 'message', 'Quote emailed successfully via Brevo!');
    ELSE
      RETURN jsonb_build_object('success', false, 'message', concat('Brevo API returned status ', resp_status, ': ', COALESCE(resp_content, 'No response body')));
    END IF;

  -- 2. Fall back to Resend API
  ELSE
    SELECT status, content INTO resp_status, resp_content
    FROM http((
      'POST',
      'https://api.resend.com/emails',
      ARRAY[
        http_header('Authorization', 'Bearer ' || resend_key),
        http_header('Content-Type', 'application/json')
      ],
      'application/json',
      jsonb_build_object(
        'from', p_company_name || ' <Quotes@mybidbook.com>',
        'to', array[p_to_email],
        'cc', p_cc_emails,
        'bcc', array[p_company_email],
        'reply_to', p_company_email,
        'subject', p_subject,
        'html', '<div style="font-family: sans-serif; white-space: pre-wrap; font-size: 15px; line-height: 1.6; color: #334155;">' || p_msg || '</div>'
      )::text
    )::http_request);

    IF resp_status >= 200 AND resp_status < 300 THEN
      RETURN jsonb_build_object('success', true, 'message', 'Quote emailed successfully via Resend!');
    ELSE
      RETURN jsonb_build_object('success', false, 'message', concat('Resend API returned status ', resp_status, ': ', COALESCE(resp_content, 'No response body')));
    END IF;
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql;
