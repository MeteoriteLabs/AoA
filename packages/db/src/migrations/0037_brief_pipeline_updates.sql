ALTER TABLE "debriefs" ADD COLUMN "goal_id" uuid REFERENCES "goals"("id") ON DELETE set null;
ALTER TABLE "briefs" ADD COLUMN "goal_id" uuid REFERENCES "goals"("id") ON DELETE set null;
ALTER TABLE "brief_items" ADD COLUMN "suggested_layer" text;
ALTER TABLE "brief_items" ADD COLUMN "layer" text;
ALTER TABLE "brief_items" ADD COLUMN "dedup_action" text;
ALTER TABLE "brief_items" ADD COLUMN "selected_memory_id" uuid REFERENCES "memory_items"("id") ON DELETE set null;
ALTER TABLE "brief_items" ADD COLUMN "merged_content" text;
