-- Nullable: existing approved publications preserve their original plain transport.
ALTER TABLE "Publication" ADD COLUMN "telegramFormatSnapshot" JSONB;
