import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  /**
   * Generate a 1536-dimensional embedding vector for the given text.
   * Returns null on failure so the app doesn't crash — the user is simply
   * skipped in search results until their embedding is generated.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small', // 1536 dimensions
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('Embedding generation failed:', error);
      return null;
    }
  }
}
