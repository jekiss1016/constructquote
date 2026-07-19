-- Create Schedule Templates Table
CREATE TABLE IF NOT EXISTS public.schedule_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Setup RLS
ALTER TABLE public.schedule_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select templates in their company" ON public.schedule_templates
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Owners, admins, editors can insert templates" ON public.schedule_templates
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('owner', 'sysadmin', 'editor')
    )
  );

CREATE POLICY "Owners, admins, editors can update templates" ON public.schedule_templates
  FOR UPDATE USING (
    company_id IN (
      SELECT company_id FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('owner', 'sysadmin', 'editor')
    )
  );

CREATE POLICY "Owners, admins, editors can delete templates" ON public.schedule_templates
  FOR DELETE USING (
    company_id IN (
      SELECT company_id FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('owner', 'sysadmin', 'editor')
    )
  );
