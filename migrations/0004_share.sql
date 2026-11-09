ALTER TABLE campaigns ADD COLUMN shareToken TEXT;
CREATE UNIQUE INDEX campaigns_share ON campaigns(shareToken) WHERE shareToken IS NOT NULL;
ALTER TABLE preorders ADD COLUMN buyerSessionId TEXT;
CREATE INDEX preorders_buyer ON preorders(buyerSessionId, createdAt);
