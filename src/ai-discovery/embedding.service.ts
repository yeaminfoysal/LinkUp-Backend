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
      const model = this.genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
      const result = await model.embedContent(text);
      const embedding = result.embedding.values;
      
      // PostgreSQL schema is vector(1536), but gemini-embedding-2 returns 3072 dimensions.
      if (embedding.length > 1536) {
        return embedding.slice(0, 1536);
      } else if (embedding.length < 1536) {
        const padded = new Array(1536).fill(0);
        for (let i = 0; i < embedding.length; i++) {
          padded[i] = embedding[i];
        }
        return padded;
      }
      return embedding as number[];
    } catch (error) {
      console.error('Embedding generation failed:', error);
      return null;
    }
  }
}
