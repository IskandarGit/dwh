-- ============================================================================
-- DWH Platform - Expand Custom Fields Supported Entity Types V029
-- ============================================================================

-- Drop restrictive check constraint and allow NOTE and extensible entity codes
alter table md_custom_fields drop constraint if exists md_custom_fields_entity_type_check;

alter table md_custom_fields add constraint md_custom_fields_entity_type_check
    check (entity_type ~ '^[A-Z][A-Z0-9_]{1,31}$');

-- Index for efficient retrieval by entity and display order
create index if not exists idx_md_custom_fields_entity_order
    on md_custom_fields (entity_type, order_no, id);
