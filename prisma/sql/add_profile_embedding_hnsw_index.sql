-- HNSW index for fast approximate nearest-neighbor search on profile embeddings.
-- HNSW is preferred over ivfflat: better recall, no training step, and it
-- works well even while the table is small.
-- Requires pgvector >= 0.5.0.
--
-- Apply with:
--   npx prisma db execute --file prisma/sql/add_profile_embedding_hnsw_index.sql

CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS "User_profileEmbedding_hnsw_idx"
ON "User"
USING hnsw ("profileEmbedding" vector_cosine_ops);
