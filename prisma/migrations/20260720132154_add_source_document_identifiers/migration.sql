-- AlterTable
ALTER TABLE "source_documents" ADD COLUMN     "feed_build_date" TIMESTAMP(3),
ADD COLUMN     "gmail_message_id" TEXT;

-- CreateIndex
CREATE INDEX "source_documents_gmail_message_id_idx" ON "source_documents"("gmail_message_id");
