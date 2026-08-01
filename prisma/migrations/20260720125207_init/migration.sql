-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('RSS', 'NEWSLETTER');

-- CreateEnum
CREATE TYPE "ai_task" AS ENUM ('NEWSLETTER_CLEANUP', 'COMPOSE');

-- CreateTable
CREATE TABLE "sources" (
    "id" SERIAL NOT NULL,
    "type" "source_type" NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_documents" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "brief_id" INTEGER NOT NULL,
    "raw" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefs" (
    "id" SERIAL NOT NULL,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "corpus" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructions" (
    "id" SERIAL NOT NULL,
    "task" "ai_task" NOT NULL,
    "body" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_calls" (
    "id" SERIAL NOT NULL,
    "task" "ai_task" NOT NULL,
    "model" TEXT NOT NULL,
    "reasoning" TEXT,
    "instructions_id" INTEGER NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_document_id" INTEGER,
    "brief_id" INTEGER,

    CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sources_type_identifier_key" ON "sources"("type", "identifier");

-- CreateIndex
CREATE INDEX "source_documents_source_id_idx" ON "source_documents"("source_id");

-- CreateIndex
CREATE INDEX "source_documents_brief_id_idx" ON "source_documents"("brief_id");

-- CreateIndex
CREATE INDEX "briefs_sent_at_idx" ON "briefs"("sent_at");

-- CreateIndex
CREATE INDEX "instructions_task_created_at_idx" ON "instructions"("task", "created_at");

-- CreateIndex
CREATE INDEX "ai_calls_task_idx" ON "ai_calls"("task");

-- CreateIndex
CREATE INDEX "ai_calls_brief_id_idx" ON "ai_calls"("brief_id");

-- CreateIndex
CREATE INDEX "ai_calls_source_document_id_idx" ON "ai_calls"("source_document_id");

-- CreateIndex
CREATE INDEX "ai_calls_instructions_id_idx" ON "ai_calls"("instructions_id");

-- AddForeignKey
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "briefs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_instructions_id_fkey" FOREIGN KEY ("instructions_id") REFERENCES "instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
