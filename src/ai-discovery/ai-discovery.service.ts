/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

interface UserProfile {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  bio: string | null;
  location: string | null;
  university: string | null;
  department: string | null;
  skills: string | null;
  interests: string | null;
  profession: string | null;
  work_place: string | null;
  isOnline: boolean;
  embeddingUpdatedAt: Date | null;
}

interface SearchResultRow extends UserProfile {
  match_score: number;
}

@Injectable()
export class AiDiscoveryService {
  private genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) { }

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Text Builder
  // ─────────────────────────────────────────────────────────────────────────────

  buildProfileText(user: {
    name?: string | null;
    bio?: string | null;
    location?: string | null;
    university?: string | null;
    department?: string | null;
    skills?: string | null;
    interests?: string | null;
    profession?: string | null;
    work_place?: string | null;
  }): string {
    const parts: string[] = [];

    if (user.name) parts.push(`Name: ${user.name}`);
    if (user.bio) parts.push(`Bio: ${user.bio}`);
    if (user.location) parts.push(`Location: ${user.location}`);
    if (user.university) parts.push(`University: ${user.university}`);
    if (user.department) parts.push(`Department: ${user.department}`);
    if (user.skills) parts.push(`Skills: ${user.skills}`);
    if (user.interests) parts.push(`Interests: ${user.interests}`);
    if (user.profession) parts.push(`Profession: ${user.profession}`);
    if (user.work_place) parts.push(`Work Place: ${user.work_place}`);

    return parts.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Embedding Update (async — called in background)
  // ─────────────────────────────────────────────────────────────────────────────

  async updateUserEmbedding(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        bio: true,
        location: true,
        university: true,
        department: true,
        skills: true,
        interests: true,
        profession: true,
        work_place: true,
      },
    });

    if (!user) return;

    const profileText = this.buildProfileText(user);
    if (!profileText.trim()) return; // Nothing to embed

    const embedding = await this.embeddingService.generateEmbedding(profileText);
    if (!embedding) return;

    // Prisma doesn't support vector type natively — use raw SQL
    const vectorLiteral = `[${embedding.join(',')}]`;
    await this.prisma.$executeRaw`
      UPDATE "User"
      SET
        "profileText"       = ${profileText},
        "profileEmbedding"  = ${vectorLiteral}::vector,
        "embeddingUpdatedAt" = NOW()
      WHERE id = ${userId}
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Natural Language User Search
  // ─────────────────────────────────────────────────────────────────────────────

  async searchUsers(query: string, currentUserId: string) {
    // Step 1: Collect blocked user IDs (bidirectional)
    const blocked = await this.prisma.blockedUser.findMany({
      where: {
        OR: [
          { blockedById: currentUserId },
          { blockedUserId: currentUserId },
        ],
      },
      select: { blockedById: true, blockedUserId: true },
    });

    const blockedIds = blocked.map((b) =>
      b.blockedById === currentUserId ? b.blockedUserId : b.blockedById,
    );

    // Step 2: Convert query to embedding vector
    const queryVector = await this.embeddingService.generateEmbedding(query);
    if (!queryVector) {
      throw new ServiceUnavailableException(
        'AI search is temporarily unavailable. Please try again later.',
      );
    }

    // Step 3: pgvector cosine similarity search
    const vectorLiteral = `[${queryVector.join(',')}]`;

    // Use a safe placeholder for empty blocked list
    const excludeIds = [currentUserId, ...blockedIds];

    const results = await this.prisma.$queryRaw<SearchResultRow[]>`
      SELECT
        id,
        name,
        username,
        avatar,
        bio,
        location,
        university,
        department,
        skills,
        interests,
        profession,
        work_place,
        "isOnline",
        "embeddingUpdatedAt",
        ROUND(
          (1 - ("profileEmbedding" <=> ${vectorLiteral}::vector)) * 100
        ) AS match_score
      FROM "User"
      WHERE
        id != ALL(${excludeIds}::text[])
        AND "profileEmbedding" IS NOT NULL
        AND (1 - ("profileEmbedding" <=> ${vectorLiteral}::vector)) > 0.6
      ORDER BY "profileEmbedding" <=> ${vectorLiteral}::vector
      LIMIT 20
    `;

    // Step 4: Generate match reasons in parallel (using Genmini gpt-4o-mini)
    const enriched = await Promise.all(
      results.map(async (user) => {
        const matchReason = await this.generateMatchReason({
          bio: user.bio,
          university: user.university,
          department: user.department,
          skills: user.skills,
          interests: user.interests,
          profession: user.profession,
          work_place: user.work_place,
          query,
          score: Number(user.match_score),
        });

        return {
          id: user.id,
          name: user.name,
          username: user.username,
          avatar: user.avatar,
          bio: user.bio,
          location: user.location,
          university: user.university,
          department: user.department,
          skills: user.skills,
          interests: user.interests,
          profession: user.profession,
          work_place: user.work_place,
          isOnline: user.isOnline,
          embeddingUpdatedAt: user.embeddingUpdatedAt,
          matchScore: Number(user.match_score),
          matchReason,
        };
      }),
    );

    return enriched;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Match Reason Generator (Genmini gpt-4o-mini)
  // ─────────────────────────────────────────────────────────────────────────────

  async generateMatchReason(params: {
    bio?: string | null;
    university?: string | null;
    department?: string | null;
    skills?: string | null;
    interests?: string | null;
    profession?: string | null;
    work_place?: string | null;
    query: string;
    score: number;
  }): Promise<string> {
    const {
      bio,
      university,
      department,
      skills,
      interests,
      profession,
      work_place,
      query,
      score,
    } = params;

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const prompt = `
Search query: "${query}"
User bio: "${bio ?? ''}"
User university: "${university ?? ''}"
User department: "${department ?? ''}"
User skills: "${skills ?? ''}"
User interests: "${interests ?? ''}"
User profession: "${profession ?? ''}"
User work_place: "${work_place ?? ''}"
Match score: ${score}%

Write a 1 sentence reason why this user matches the search.
Be specific. Max 10 words. No filler words.
Example: "NestJS developer with strong AI interest in Dhaka"
      `.trim();

      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text().trim() || 'Good match for your search';
    } catch (error) {
      console.error('Match reason generation failed:', error);
      return 'Matches your search criteria';
    }
  }
}
