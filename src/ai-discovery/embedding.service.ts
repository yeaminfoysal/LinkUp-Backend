import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class EmbeddingService {
  private genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

  /**
   * Generate a 1536-dimensional embedding vector for the given text.
   * Returns null on failure so the app doesn't crash — the user is simply
   * skipped in search results until their embedding is generated.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-embedding-2',
      });
      // Pass outputDimensionality so the model natively projects it to 1536 dims
      const result = await model.embedContent({
        content: { role: 'user', parts: [{ text }] },
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
