/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
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
  ) {}

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

    const embedding =
      await this.embeddingService.generateEmbedding(profileText);
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
        OR: [{ blockedById: currentUserId }, { blockedUserId: currentUserId }],
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

    const calculateNormalizedScore = (rawScore: number): number => {
      if (isNaN(rawScore) || rawScore < 0) return 60;
      // In asymmetric semantic search (short query vs long profile), raw scores are typically 60-80.
      // We boost by +20 so the minimum valid match (60 raw) is perceived as an 80% match.
      const boosted = rawScore + 20;
      return boosted > 99 && rawScore < 100 ? 99 : Math.min(100, boosted);
    };

    // Step 4: Map and filter high quality matches BEFORE hitting the Gemini API to save quota
    const highQualityMatches = results
      .map((user) => {
        const rawScore = Number(user.match_score) || 0;
        return {
          ...user,
          matchScore: calculateNormalizedScore(rawScore),
        };
      })
      .filter((user) => user.matchScore >= 80);

    // Step 5: Generate match reasons in a single batched API call for the remaining matches
    const usersDataForPrompt = highQualityMatches.map((u) => ({
      bio: u.bio,
      university: u.university,
      department: u.department,
      skills: u.skills,
      interests: u.interests,
      profession: u.profession,
      work_place: u.work_place,
      score: u.matchScore,
    }));

    const reasons = await this.generateMatchReasonsBatch(
      usersDataForPrompt,
      query,
    );

    const enriched = highQualityMatches.map((user, index) => {
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
        matchScore: user.matchScore,
        matchReason: reasons[index] || 'Matches your search criteria',
      };
    });

    return enriched;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Batched Match Reason Generator (Gemini 2.0 Flash)
  // ─────────────────────────────────────────────────────────────────────────────

  async generateMatchReasonsBatch(
    users: Array<{
      bio?: string | null;
      university?: string | null;
      department?: string | null;
      skills?: string | null;
      interests?: string | null;
      profession?: string | null;
      work_place?: string | null;
      score: number;
    }>,
    query: string,
  ): Promise<string[]> {
    if (users.length === 0) return [];

    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
      });

      const userListStr = users
        .map(
          (u, i) => `User ${i + 1}:
Bio: "${u.bio ?? ''}"
University: "${u.university ?? ''}"
Department: "${u.department ?? ''}"
Skills: "${u.skills ?? ''}"
Interests: "${u.interests ?? ''}"
Profession: "${u.profession ?? ''}"
Work Place: "${u.work_place ?? ''}"
Score: ${u.score}%`,
        )
        .join('\n\n');

      const prompt = `
Search query: "${query}"

Here is a list of users matching the query:
${userListStr}

For EACH user, write a 1-sentence reason why they match the search. Be specific. Max 10 words per reason. No filler words.
Return the reasons as a JSON array of strings in the exact same order as the users. DO NOT return any markdown formatting like \`\`\`json, just the raw JSON array.
Example: ["NestJS developer with strong AI interest in Dhaka", "BUET grad working on machine learning"]


      `.trim();

      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim();

      // Clean up potential markdown formatting if model ignores instruction
      const cleanedJson = responseText
        .replace(/^```json/i, '')
        .replace(/^```/, '')
        .replace(/```$/i, '')
        .trim();

      const reasons = JSON.parse(cleanedJson);

      if (Array.isArray(reasons) && reasons.length === users.length) {
        return reasons;
      } else {
        return users.map(() => 'Good match for your search criteria');
      }
    } catch (error: any) {
      if (error?.status === 429) {
        console.warn(
          '⚠️ Gemini API rate limit exceeded. Falling back to default match reasons.',
        );
      } else {
        console.error(
          '⚠️ Batch match reason generation failed:',
          error?.message || error,
        );
      }
      return users.map(() => 'Matches your search criteria');
    }
  }
}
