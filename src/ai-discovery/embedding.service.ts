import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

@Injectable()
export class EmbeddingService {
  private genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

  /**
   * Generate a 1536-dimensional embedding vector for the given text.
   *
   * `taskType` matters for asymmetric search quality:
   * - RETRIEVAL_DOCUMENT → use when embedding user profiles (long documents)
   * - RETRIEVAL_QUERY    → use when embedding short search queries
   * Mixing them up (or omitting them) makes short-query-vs-long-profile
   * similarity scores unreliable.
   *
   * Returns null on failure so the app doesn't crash — the user is simply
   * skipped in search results until their embedding is generated.
   */
  async generateEmbedding(
    text: string,
    taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT,
  ): Promise<number[] | null> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-embedding-2',
      });
      // Pass outputDimensionality so the model natively projects it to 1536 dims
      const result = await model.embedContent({
        content: { role: 'user', parts: [{ text }] },
        taskType,
        outputDimensionality: 1536,
      } as any);
      const embedding = result.embedding.values;

      return embedding as number[];
    } catch (error) {
      console.error('Embedding generation failed:', error);
      return null;
    }
  }
}
