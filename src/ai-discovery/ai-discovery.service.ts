 
 
 
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  GoogleGenerativeAI,
  SchemaType,
  TaskType,
} from '@google/generative-ai';
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

type FriendshipStatus =
  | 'FRIENDS'
  | 'REQUEST_SENT'
  | 'REQUEST_RECEIVED'
  | 'NONE';

type MatchType = 'name' | 'semantic';

interface MatchVerdict {
  reason: string;
  isRelevant: boolean;
}

const USER_RESULT_SELECT = {
  id: true,
  name: true,
  username: true,
  avatar: true,
  bio: true,
  location: true,
  university: true,
  department: true,
  skills: true,
  interests: true,
  profession: true,
  work_place: true,
  isOnline: true,
  embeddingUpdatedAt: true,
} as const;

// Minimum cosine similarity for a semantic match. Profiles are embedded with
// RETRIEVAL_DOCUMENT and queries with RETRIEVAL_QUERY, so scores are already
// calibrated for asymmetric search — no artificial boosting needed.
const SIMILARITY_THRESHOLD = 0.5;
const MAX_SEMANTIC_RESULTS = 20;
const MAX_NAME_RESULTS = 5;
const DEFAULT_REASON = 'Matches your search criteria';
// When the AI verdict call fails, only keep results within this many score
// points of the top result — prevents the weak similarity tail from flooding
// the list
const FALLBACK_SCORE_GAP = 10;

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

  /** Returns true when an embedding was written, false when skipped/failed. */
  async updateUserEmbedding(userId: string): Promise<boolean> {
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

    if (!user) return false;

    const profileText = this.buildProfileText(user);
    if (!profileText.trim()) return false; // Nothing to embed

    const embedding = await this.embeddingService.generateEmbedding(
      profileText,
      TaskType.RETRIEVAL_DOCUMENT,
    );
    if (!embedding) return false;

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
    return true;
  }

  /**
   * Regenerate embeddings for every user. Needed after changing the embedding
   * model or taskType, since old and new vectors are not comparable.
   * Runs sequentially to stay within embedding API rate limits.
   */
  async regenerateAllEmbeddings(): Promise<{
    total: number;
    updated: number;
    skipped: number;
    failed: number;
  }> {
    const users = await this.prisma.user.findMany({ select: { id: true } });

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const { id } of users) {
      try {
        const ok = await this.updateUserEmbedding(id);
        if (ok) updated++;
        else skipped++;
      } catch (error) {
        failed++;
        console.error(`Embedding regeneration failed for user ${id}:`, error);
      }
    }

    return { total: users.length, updated, skipped, failed };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Natural Language User Search (hybrid: semantic + exact name match)
  // ─────────────────────────────────────────────────────────────────────────────

  async searchUsers(query: string, currentUserId: string) {
    const trimmedQuery = query.trim();

    // Step 1: blocked user IDs (bidirectional) + query embedding, in parallel
    const [blocked, queryVector] = await Promise.all([
      this.prisma.blockedUser.findMany({
        where: {
          OR: [
            { blockedById: currentUserId },
            { blockedUserId: currentUserId },
          ],
        },
        select: { blockedById: true, blockedUserId: true },
      }),
      this.embeddingService.generateEmbedding(
        trimmedQuery,
        TaskType.RETRIEVAL_QUERY,
      ),
    ]);

    if (!queryVector) {
      throw new ServiceUnavailableException(
        'AI search is temporarily unavailable. Please try again later.',
      );
    }

    const blockedIds = blocked.map((b) =>
      b.blockedById === currentUserId ? b.blockedUserId : b.blockedById,
    );
    const excludeIds = [currentUserId, ...blockedIds];

    // Step 2: pgvector cosine similarity search + exact name/username match,
    // in parallel. The name match covers what embeddings are weak at (proper
    // nouns) and also finds users who don't have an embedding yet.
    const vectorLiteral = `[${queryVector.join(',')}]`;

    const [semanticRows, nameMatches] = await Promise.all([
      this.prisma.$queryRaw<SearchResultRow[]>`
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
          AND (1 - ("profileEmbedding" <=> ${vectorLiteral}::vector)) > ${SIMILARITY_THRESHOLD}
        ORDER BY "profileEmbedding" <=> ${vectorLiteral}::vector
        LIMIT ${MAX_SEMANTIC_RESULTS}
      `,
      this.prisma.user.findMany({
        where: {
          id: { notIn: excludeIds },
          OR: [
            { name: { contains: trimmedQuery, mode: 'insensitive' } },
            { username: { contains: trimmedQuery, mode: 'insensitive' } },
          ],
        },
        select: USER_RESULT_SELECT,
        take: MAX_NAME_RESULTS,
      }),
    ]);

    // Step 3: honest match scores — cosine similarity as a percentage,
    // no artificial boosting, so users can tell strong matches from weak ones
    const semanticMatches = semanticRows.map((user) => ({
      ...user,
      matchScore: Math.min(100, Math.max(0, Number(user.match_score) || 0)),
    }));

    // Step 4: AI match verdicts (reason + relevance) + friendship statuses,
    // in parallel
    const resultIds = [
      ...new Set([
        ...nameMatches.map((u) => u.id),
        ...semanticMatches.map((u) => u.id),
      ]),
    ];

    const usersDataForPrompt = semanticMatches.map((u) => ({
      name: u.name,
      location: u.location,
      bio: u.bio,
      university: u.university,
      department: u.department,
      skills: u.skills,
      interests: u.interests,
      profession: u.profession,
      work_place: u.work_place,
      score: u.matchScore,
    }));

    const [verdicts, friendshipMap] = await Promise.all([
      this.generateMatchVerdictsBatch(usersDataForPrompt, trimmedQuery),
      this.getFriendshipStatuses(currentUserId, resultIds),
    ]);

    // Step 5: relevance filtering. Vector similarity has a weak tail — users
    // in the mid-60s can fail the query's explicit constraints (wrong city,
    // missing skill) while still being vaguely similar. The AI verdict from
    // the same call that writes the match reasons removes those.
    let relevantSemantic: Array<
      (typeof semanticMatches)[number] & { matchReason: string }
    >;
    if (verdicts) {
      relevantSemantic = semanticMatches
        .map((user, index) => ({ user, verdict: verdicts[index] }))
        .filter(({ verdict }) => verdict.isRelevant)
        .map(({ user, verdict }) => ({ ...user, matchReason: verdict.reason }));
    } else {
      // Gemini unavailable — fall back to a score-gap cutoff
      const topScore = semanticMatches[0]?.matchScore ?? 0;
      relevantSemantic = semanticMatches
        .filter((user) => user.matchScore >= topScore - FALLBACK_SCORE_GAP)
        .map((user) => ({ ...user, matchReason: DEFAULT_REASON }));
    }

    const semanticById = new Map(relevantSemantic.map((u) => [u.id, u]));

    // Step 6: merge — exact name matches first (clearly what the user wants
    // when searching a name), then relevant semantic matches; dedupe by id
    const merged: Array<
      UserProfile & {
        matchScore: number | null;
        matchReason: string;
        matchType: MatchType;
      }
    > = [];
    const seen = new Set<string>();

    for (const user of nameMatches) {
      const semanticUser = semanticById.get(user.id);
      merged.push({
        ...user,
        matchScore: semanticUser ? semanticUser.matchScore : null,
        matchReason: semanticUser
          ? semanticUser.matchReason
          : 'Name or username matches your search',
        matchType: 'name',
      });
      seen.add(user.id);
    }

    for (const user of relevantSemantic) {
      if (seen.has(user.id)) continue;
      merged.push({ ...user, matchType: 'semantic' });
    }

    // Step 7: final response shape
    return merged.map((user) => ({
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
      matchReason: user.matchReason,
      matchType: user.matchType,
      friendshipStatus: friendshipMap.get(user.id) ?? 'NONE',
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Friendship Status Lookup
  // ─────────────────────────────────────────────────────────────────────────────

  private async getFriendshipStatuses(
    currentUserId: string,
    userIds: string[],
  ): Promise<Map<string, FriendshipStatus>> {
    const statusMap = new Map<string, FriendshipStatus>();
    if (userIds.length === 0) return statusMap;

    const [friendships, pendingRequests] = await Promise.all([
      this.prisma.friendship.findMany({
        where: {
          OR: [
            { user1Id: currentUserId, user2Id: { in: userIds } },
            { user2Id: currentUserId, user1Id: { in: userIds } },
          ],
        },
        select: { user1Id: true, user2Id: true },
      }),
      this.prisma.friendRequest.findMany({
        where: {
          status: 'PENDING',
          OR: [
            { senderId: currentUserId, receiverId: { in: userIds } },
            { receiverId: currentUserId, senderId: { in: userIds } },
          ],
        },
        select: { senderId: true, receiverId: true },
      }),
    ]);

    for (const f of friendships) {
      const otherId = f.user1Id === currentUserId ? f.user2Id : f.user1Id;
      statusMap.set(otherId, 'FRIENDS');
    }

    for (const r of pendingRequests) {
      const otherId = r.senderId === currentUserId ? r.receiverId : r.senderId;
      if (!statusMap.has(otherId)) {
        statusMap.set(
          otherId,
          r.senderId === currentUserId ? 'REQUEST_SENT' : 'REQUEST_RECEIVED',
        );
      }
    }

    return statusMap;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Batched Match Verdict Generator (Gemini, structured JSON output)
  // Returns one { reason, isRelevant } per user, or null if the AI call failed
  // ─────────────────────────────────────────────────────────────────────────────

  async generateMatchVerdictsBatch(
    users: Array<{
      name?: string | null;
      location?: string | null;
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
  ): Promise<MatchVerdict[] | null> {
    if (users.length === 0) return [];

    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        generationConfig: {
          // Forces valid JSON — no markdown fences, no parse failures
          responseMimeType: 'application/json',
          responseSchema: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                reason: { type: SchemaType.STRING },
                isRelevant: { type: SchemaType.BOOLEAN },
              },
              required: ['reason', 'isRelevant'],
            },
          },
        },
      });

      const userListStr = users
        .map(
          (u, i) => `User ${i + 1}:
Name: "${u.name ?? ''}"
Location: "${u.location ?? ''}"
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

Candidate users found by vector similarity (some may NOT actually satisfy the query):
${userListStr}

For EACH user, return:
1. "isRelevant": true ONLY if the user genuinely satisfies the explicit requirements of the query (skills, location, role, university, etc.). If the user clearly fails any explicit requirement (e.g. different city, missing skill), set it to false. When the query is broad or has no hard constraints, lean towards true.
2. "reason": one specific sentence (max 10 words, no filler words) explaining why they match — or why not.

Return a JSON array of objects in the exact same order as the users.
Example: [{"reason": "NestJS developer with strong AI interest in Dhaka", "isRelevant": true}, {"reason": "Based in Khulna, no JavaScript skills", "isRelevant": false}]
      `.trim();

      const result = await model.generateContent(prompt);
      const parsed = JSON.parse(result.response.text());

      if (!Array.isArray(parsed)) return null;

      // Per-index normalization: a malformed entry shouldn't discard the rest.
      // Missing relevance defaults to true so model errors never hide users.
      return users.map((_, i) => {
        const v = parsed[i] ?? {};
        return {
          reason:
            typeof v.reason === 'string' && v.reason.trim()
              ? v.reason.trim()
              : DEFAULT_REASON,
          isRelevant: v.isRelevant !== false,
        };
      });
    } catch (error: any) {
      if (error?.status === 429) {
        console.warn(
          '⚠️ Gemini API rate limit exceeded. Falling back to score-gap filtering.',
        );
      } else {
        console.error(
          '⚠️ Batch match verdict generation failed:',
          error?.message || error,
        );
      }
      return null;
    }
  }
}
