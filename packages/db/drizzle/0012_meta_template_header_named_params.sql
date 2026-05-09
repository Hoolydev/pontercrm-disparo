-- Extend Meta-approved template support:
--   1) Header media (video/image/document) — required by templates whose
--      HEADER is non-text, e.g. mensagem_nativa with a video header.
--   2) Named body params — Meta started supporting `{{name}}` placeholders
--      with `parameter_name` in send payload (alongside positional `{{1}}`).
--      Param map already exists; we add an optional `name` field per slot.
--
-- Both columns optional: existing campaigns continue to work unchanged.
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "meta_template_header_json" jsonb;
