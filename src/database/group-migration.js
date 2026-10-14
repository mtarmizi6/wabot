// Add snapshot metadata without rewriting group identities or campaign targets.
export const groupMigration = `
ALTER TABLE whatsapp_groups ADD COLUMN participant_count_known INTEGER NOT NULL DEFAULT 0 CHECK (participant_count_known IN (0,1));
ALTER TABLE whatsapp_groups ADD COLUMN account_role TEXT CHECK (account_role IN ('ADMIN','MEMBER'));
ALTER TABLE whatsapp_groups ADD COLUMN announcement INTEGER CHECK (announcement IN (0,1));
UPDATE whatsapp_groups SET participant_count_known=1 WHERE participant_count>0;
ALTER TABLE whatsapp_group_sync_stage ADD COLUMN participant_count_known INTEGER NOT NULL DEFAULT 0 CHECK (participant_count_known IN (0,1));
ALTER TABLE whatsapp_group_sync_stage ADD COLUMN account_role TEXT CHECK (account_role IN ('ADMIN','MEMBER'));
ALTER TABLE whatsapp_group_sync_stage ADD COLUMN announcement INTEGER CHECK (announcement IN (0,1));
DELETE FROM whatsapp_group_sync_stage;
`;
