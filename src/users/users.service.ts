 
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchUserDto } from './dto/search-user.dto';
import { AiDiscoveryService } from '../ai-discovery/ai-discovery.service';
import { buildOffsetPagination } from '../common/utils/pagination.util';

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
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
  lastSeen: true,
  createdAt: true,
  updatedAt: true,
  role: true,
};

// Fields that affect the AI embedding — trigger regeneration when any changes
const EMBEDDING_FIELDS = [
  'name',
  'bio',
  'location',
  'university',
  'department',
  'skills',
  'interests',
  'profession',
  'work_place',
] as const;

// ─── Smart Matches scoring ────────────────────────────────────────────────────
// Raw points per signal. Mutual friends carry the most total weight — in a
// social network they're a stronger signal than any single profile field.
const SUGGESTION_WEIGHTS = {
  university: 15,
  work_place: 15,
  profession: 12,
  location: 10,
  department: 6,
  perSkill: 4,
  maxSkills: 12,
  perInterest: 3,
  maxInterests: 9,
  perMutualFriend: 6,
  maxMutualFriends: 24,
  maxEmbedding: 20,
};
// Profile↔profile cosine similarity below the floor earns nothing; at/above
// the ceiling it earns maxEmbedding points (linear in between). Profiles all
// share the same template/language, so unrelated pairs already sit high —
// hence the high static floor.
const EMBEDDING_SIM_FLOOR = 0.78;
const EMBEDDING_SIM_CEIL = 0.92;
// The baseline shifts with the embedding model, so the floor is also
// calibrated against the candidate pool's own median: only candidates
// meaningfully above "how similar everyone is to me anyway" earn points
const EMBEDDING_BASELINE_MARGIN = 0.03;
const MIN_SIMS_FOR_BASELINE = 5;
// Raw points that display as ~100% match. Honest reference for a very strong
// match (e.g. same university + profession + location + shared skills) —
// no flat "+50" inflation.
const FULL_MATCH_POINTS = 60;
// How many embedding-nearest users to pull into the candidate pool, so
// semantically similar people surface even with zero literal word overlap
const VECTOR_CANDIDATE_LIMIT = 30;
const CANDIDATE_POOL_LIMIT = 100;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private aiDiscoveryService: AiDiscoveryService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    // Build update data — only include defined fields
    const data: Record<string, unknown> = {};
    if (dto.name) data.name = dto.name;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.university !== undefined) data.university = dto.university;
    if (dto.department !== undefined) data.department = dto.department;
    if (dto.skills !== undefined) data.skills = dto.skills;
    if (dto.interests !== undefined) data.interests = dto.interests;
    if (dto.profession !== undefined) data.profession = dto.profession;
    if (dto.work_place !== undefined) data.work_place = dto.work_place;

    // Save profile immediately
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: USER_SELECT,
    });

    // Trigger background embedding update if any relevant field changed
    const needsEmbeddingUpdate = EMBEDDING_FIELDS.some(
      (field) => (dto as Record<string, unknown>)[field] !== undefined,
    );

    if (needsEmbeddingUpdate) {
      // Fire-and-forget — don't await, don't block the response
      this.aiDiscoveryService.updateUserEmbedding(userId).catch(console.error);
    }

    return updated;
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async searchUsers(dto: SearchUserDto, requesterId: string) {
    const { take, skip } = buildOffsetPagination(dto.page, dto.limit);

    // Get users blocked by or blocking the requester
    const blocks = await this.prisma.blockedUser.findMany({
      where: {
        OR: [{ blockedById: requesterId }, { blockedUserId: requesterId }],
      },
      select: { blockedById: true, blockedUserId: true },
    });

    const blockedIds = new Set<string>();
    for (const b of blocks) {
      blockedIds.add(b.blockedById);
      blockedIds.add(b.blockedUserId);
    }
    blockedIds.delete(requesterId);

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { id: { notIn: Array.from(blockedIds) } },
          {
            OR: [
              { name: { contains: dto.query, mode: 'insensitive' } },
              { username: { contains: dto.query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: USER_SELECT,
      take,
      skip,
    });

    return users;
  }

  async getSuggestions(
    userId: string,
    limit: number,
    isGlobal: boolean = false,
  ) {
    // 1. Exclusion sources + own profile, in parallel
    const [blocks, friendships, pendingRequests, currentUser] =
      await Promise.all([
        this.prisma.blockedUser.findMany({
          where: {
            OR: [{ blockedById: userId }, { blockedUserId: userId }],
          },
          select: { blockedById: true, blockedUserId: true },
        }),
        this.prisma.friendship.findMany({
          where: {
            OR: [{ user1Id: userId }, { user2Id: userId }],
          },
          select: { user1Id: true, user2Id: true },
        }),
        this.prisma.friendRequest.findMany({
          where: {
            OR: [{ senderId: userId }, { receiverId: userId }],
            status: 'PENDING',
          },
          select: { senderId: true, receiverId: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            location: true,
            university: true,
            department: true,
            skills: true,
            interests: true,
            profession: true,
            work_place: true,
          },
        }),
      ]);

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    const blockedUserIds = blocks.map((b) =>
      b.blockedById === userId ? b.blockedUserId : b.blockedById,
    );
    const friendIds = friendships.map((f) =>
      f.user1Id === userId ? f.user2Id : f.user1Id,
    );
    const pendingUserIds = pendingRequests.map((r) =>
      r.senderId === userId ? r.receiverId : r.senderId,
    );

    const excludeIds = [
      userId,
      ...blockedUserIds,
      ...friendIds,
      ...pendingUserIds,
    ];
    const excludeSet = new Set(excludeIds);
    const friendIdSet = new Set(friendIds);

    const userSkills = splitTokens(currentUser.skills);
    const userInterests = splitTokens(currentUser.interests);
    const userSkillNorms = new Set(userSkills.map(normalizeToken));
    const userInterestNorms = new Set(userInterests.map(normalizeToken));

    // 2. Mutual friend counts (friends-of-friends) + embedding-nearest users,
    // in parallel. Mutual friends are the strongest "people you may know"
    // signal; the vector candidates surface semantically similar profiles
    // even when no literal word overlaps.
    const [mutualRows, vectorRows] = await Promise.all([
      friendIds.length > 0
        ? this.prisma.friendship.findMany({
            where: {
              OR: [
                { user1Id: { in: friendIds } },
                { user2Id: { in: friendIds } },
              ],
            },
            select: { user1Id: true, user2Id: true },
          })
        : Promise.resolve([]),
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT c.id
        FROM "User" c, "User" me
        WHERE me.id = ${userId}
          AND me."profileEmbedding" IS NOT NULL
          AND c."profileEmbedding" IS NOT NULL
          AND c.id != ALL(${excludeIds}::text[])
        ORDER BY c."profileEmbedding" <=> me."profileEmbedding"
        LIMIT ${VECTOR_CANDIDATE_LIMIT}
      `,
    ]);

    const mutualCounts = new Map<string, number>();
    for (const f of mutualRows) {
      // Each row links one of my friends to a potential candidate; rows
      // between two of my own friends are skipped via the exclude set
      const pairs = [
        [f.user1Id, f.user2Id],
        [f.user2Id, f.user1Id],
      ] as const;
      for (const [friend, candidate] of pairs) {
        if (friendIdSet.has(friend) && !excludeSet.has(candidate)) {
          mutualCounts.set(candidate, (mutualCounts.get(candidate) ?? 0) + 1);
        }
      }
    }
    const vectorCandidateIds = vectorRows.map((r) => r.id);

    // 3. Build query filters based on commonalities (word-based matching)
    const OR_conditions: any[] = [];

    const addWordConditions = (
      field: string,
      value: string | null,
      stopWords?: Set<string>,
    ) => {
      if (!value) return;
      const words = getFilteredWords(value, stopWords);
      if (words.length === 0) {
        OR_conditions.push({
          [field]: { contains: value, mode: 'insensitive' },
        });
      } else {
        words.forEach((word) => {
          OR_conditions.push({
            [field]: { contains: word, mode: 'insensitive' },
          });
        });
      }
    };

    addWordConditions('location', currentUser.location);
    addWordConditions('university', currentUser.university);
    // Profession/department keep domain words ("software", "engineering") —
    // they're the meaning there, not filler
    addWordConditions('department', currentUser.department, MINIMAL_STOP_WORDS);
    addWordConditions('profession', currentUser.profession, MINIMAL_STOP_WORDS);
    addWordConditions('work_place', currentUser.work_place);

    userSkills.forEach((skill) => {
      OR_conditions.push({ skills: { contains: skill, mode: 'insensitive' } });
    });

    userInterests.forEach((interest) => {
      OR_conditions.push({
        interests: { contains: interest, mode: 'insensitive' },
      });
    });

    // Candidates with mutual friends or high embedding similarity belong in
    // the pool even when no profile word overlaps
    if (mutualCounts.size > 0) {
      OR_conditions.push({ id: { in: [...mutualCounts.keys()] } });
    }
    if (vectorCandidateIds.length > 0) {
      OR_conditions.push({ id: { in: vectorCandidateIds } });
    }

    const fallbackConditions = [
      { location: { not: null } },
      { university: { not: null } },
      { profession: { not: null } },
    ];

    // 4. Query candidate suggestions — prefer recently active users so the
    // arbitrary pool cap doesn't crowd out live accounts
    const candidates = await this.prisma.user.findMany({
      where: {
        id: { notIn: excludeIds },
        ...(isGlobal
          ? {}
          : OR_conditions.length > 0
            ? { OR: OR_conditions }
            : { OR: fallbackConditions }),
      },
      select: {
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
        lastSeen: true,
      },
      orderBy: { lastSeen: { sort: 'desc', nulls: 'last' } },
      take: CANDIDATE_POOL_LIMIT,
    });

    // 5. Profile↔profile embedding similarity for the whole pool (one query)
    const simById = new Map<string, number>();
    if (candidates.length > 0) {
      const simRows = await this.prisma.$queryRaw<
        Array<{ id: string; sim: number }>
      >`
        SELECT
          c.id,
          1 - (c."profileEmbedding" <=> me."profileEmbedding") AS sim
        FROM "User" c, "User" me
        WHERE me.id = ${userId}
          AND me."profileEmbedding" IS NOT NULL
          AND c."profileEmbedding" IS NOT NULL
          AND c.id = ANY(${candidates.map((c) => c.id)}::text[])
      `;
      for (const row of simRows) {
        simById.set(row.id, Number(row.sim) || 0);
      }
    }

    // Calibrate the similarity floor against the pool's own median: any two
    // profiles share template/language so the absolute baseline is high and
    // model-dependent — only candidates meaningfully above "how similar
    // everyone is to me anyway" should earn points
    let effectiveFloor = EMBEDDING_SIM_FLOOR;
    const simValues = [...simById.values()].sort((a, b) => a - b);
    if (simValues.length >= MIN_SIMS_FOR_BASELINE) {
      const median = simValues[Math.floor(simValues.length / 2)];
      effectiveFloor = Math.max(
        effectiveFloor,
        median + EMBEDDING_BASELINE_MARGIN,
      );
    }
    const effectiveCeil = Math.max(EMBEDDING_SIM_CEIL, effectiveFloor + 0.08);

    // 6a. Semantic profession matching — one Gemini batch call for candidates
    // whose profession didn't word-match. Skipped in global mode (no
    // profession context) and when the user has no profession set.
    const semanticProfessionMatches = new Set<string>();
    if (currentUser.profession && !isGlobal) {
      const needsSemanticCheck = candidates.filter(
        (c) =>
          c.profession &&
          !checkFieldOverlap(currentUser.profession, c.profession, true)
            .matches,
      );
      if (needsSemanticCheck.length > 0) {
        const results = await this.aiDiscoveryService.checkProfessionMatchBatch(
          currentUser.profession,
          needsSemanticCheck.map((c) => c.profession!),
        );
        needsSemanticCheck.forEach((c, i) => {
          if (results[i]) semanticProfessionMatches.add(c.id);
        });
      }
    }

    // 6b. Score, map matches, and sort
    const scoredCandidates = candidates.map((candidate) => {
      let rawScore = 0;
      const matchingFields: string[] = [];
      const matchingDetails: Array<{
        field: string;
        value: string;
        label: string;
      }> = [];

      // Mutual friends — strongest signal, shown first
      const mutualCount = mutualCounts.get(candidate.id) ?? 0;
      if (mutualCount > 0) {
        rawScore += Math.min(
          SUGGESTION_WEIGHTS.maxMutualFriends,
          mutualCount * SUGGESTION_WEIGHTS.perMutualFriend,
        );
        matchingFields.push('mutual_friends');
        matchingDetails.push({
          field: 'mutual_friends',
          value: String(mutualCount),
          label: 'Mutual Friends',
        });
      }

      const uniMatch = checkFieldOverlap(
        currentUser.university,
        candidate.university,
      );
      if (uniMatch.matches) {
        rawScore += SUGGESTION_WEIGHTS.university;
        matchingFields.push('university');
        matchingDetails.push({
          field: 'university',
          value: candidate.university!,
          label: 'Same University',
        });
      }

      const workMatch = checkFieldOverlap(
        currentUser.work_place,
        candidate.work_place,
      );
      if (workMatch.matches) {
        rawScore += SUGGESTION_WEIGHTS.work_place;
        matchingFields.push('work_place');
        matchingDetails.push({
          field: 'work_place',
          value: candidate.work_place!,
          label: 'Same Workplace',
        });
      }

      const profMatch = checkFieldOverlap(
        currentUser.profession,
        candidate.profession,
        true,
      );
      const semanticProfMatch =
        !profMatch.matches && semanticProfessionMatches.has(candidate.id);
      if (profMatch.matches || semanticProfMatch) {
        rawScore += SUGGESTION_WEIGHTS.profession;
        matchingFields.push('profession');
        matchingDetails.push({
          field: 'profession',
          value: candidate.profession!,
          label: profMatch.exact ? 'Same Profession' : 'Similar Profession',
        });
      }

      const locMatch = checkFieldOverlap(
        currentUser.location,
        candidate.location,
      );
      if (locMatch.matches) {
        rawScore += SUGGESTION_WEIGHTS.location;
        matchingFields.push('location');
        matchingDetails.push({
          field: 'location',
          value: candidate.location!,
          label: 'Same Location',
        });
      }

      const deptMatch = checkFieldOverlap(
        currentUser.department,
        candidate.department,
        true,
      );
      if (deptMatch.matches) {
        rawScore += SUGGESTION_WEIGHTS.department;
        matchingFields.push('department');
        matchingDetails.push({
          field: 'department',
          value: candidate.department!,
          label: deptMatch.exact ? 'Same Department' : 'Similar Department',
        });
      }

      // Skills/interests — compare normalized tokens ("Node.js" ≈ "nodejs")
      // but display the candidate's original wording
      const commonSkills = splitTokens(candidate.skills).filter((skill) =>
        userSkillNorms.has(normalizeToken(skill)),
      );
      if (commonSkills.length > 0) {
        rawScore += Math.min(
          SUGGESTION_WEIGHTS.maxSkills,
          commonSkills.length * SUGGESTION_WEIGHTS.perSkill,
        );
        matchingFields.push('skills');
        matchingDetails.push({
          field: 'skills',
          value: commonSkills.join(', '),
          label: `Shared Skills`,
        });
      }

      const commonInterests = splitTokens(candidate.interests).filter(
        (interest) => userInterestNorms.has(normalizeToken(interest)),
      );
      if (commonInterests.length > 0) {
        rawScore += Math.min(
          SUGGESTION_WEIGHTS.maxInterests,
          commonInterests.length * SUGGESTION_WEIGHTS.perInterest,
        );
        matchingFields.push('interests');
        matchingDetails.push({
          field: 'interests',
          value: commonInterests.join(', '),
          label: `Shared Interests`,
        });
      }

      // AI profile similarity — catches semantic matches word overlap misses
      const sim = simById.get(candidate.id) ?? 0;
      let simFraction = 0;
      if (sim > effectiveFloor) {
        simFraction = Math.min(
          1,
          (sim - effectiveFloor) / (effectiveCeil - effectiveFloor),
        );
        rawScore += Math.round(simFraction * SUGGESTION_WEIGHTS.maxEmbedding);
      }
      // "Similar Profile" boost: adds to score and enables the reason sentence,
      // but does NOT emit a matchingDetails badge — showing a raw similarity %
      // next to the matchScore percentage creates conflicting numbers for users.
      const strongSimilarity = simFraction >= 0.5;
      if (strongSimilarity) {
        matchingFields.push('profile_similarity');
      }

      // Honest display score: percentage of a realistic "full match",
      // capped at 99 — no flat boost
      const matchScore =
        rawScore > 0
          ? Math.min(99, Math.round((rawScore / FULL_MATCH_POINTS) * 100))
          : 0;

      const reason = buildMatchReason(
        matchingDetails,
        mutualCount,
        strongSimilarity,
      );

      return {
        ...candidate,
        matchScore,
        matchReason: reason,
        matchingFields,
        matchingDetails,
      };
    });

    // Only surface candidates with at least one visible signal (a badge the
    // user can see). Weak embedding similarity alone may boost ranking but
    // never surfaces anyone on its own — that's how "mystery suggestions"
    // with no apparent connection used to leak in.
    let validCandidates = scoredCandidates;
    if (!isGlobal) {
      validCandidates = scoredCandidates.filter(
        (candidate) => candidate.matchingFields.length > 0,
      );
    } else {
      validCandidates = scoredCandidates.map((candidate) => {
        if (candidate.matchingFields.length === 0) {
          return {
            ...candidate,
            matchScore: 0,
            matchReason: 'Suggested based on global network activity.',
          };
        }
        return candidate;
      });
    }

    // Stable random tiebreak (a comparator with Math.random() inside is
    // inconsistent and can misbehave)
    const tiebreak = new Map(
      validCandidates.map((c) => [c.id, Math.random()]),
    );
    validCandidates.sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        tiebreak.get(a.id)! - tiebreak.get(b.id)!,
    );
    return validCandidates.slice(0, limit);
  }

  async getProfileByUsername(username: string, requesterId: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        ...USER_SELECT,
        blockedUsers: {
          where: { blockedUserId: requesterId },
        },
        blockedByUsers: {
          where: { blockedById: requesterId },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const blockedByTarget = user.blockedUsers.length > 0;
    if (blockedByTarget) {
      throw new ForbiddenException('Profile unavailable');
    }

    const blockedByMe = user.blockedByUsers.length > 0;

    const { blockedUsers, blockedByUsers, ...profileData } = user as any;

    return {
      ...profileData,
      isBlockedByMe: blockedByMe,
    };
  }

  async setOnlineStatus(userId: string, isOnline: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isOnline,
        lastSeen: isOnline ? undefined : new Date(),
      },
    });
  }
}

function buildMatchReason(
  matchingDetails: Array<{ field: string; value: string; label: string }>,
  mutualFriendCount: number,
  strongSimilarity: boolean,
): string {
  const mutualSentence =
    mutualFriendCount > 0
      ? `You have ${mutualFriendCount} mutual friend${mutualFriendCount > 1 ? 's' : ''}.`
      : '';

  const fieldReason = buildFieldReason(matchingDetails);

  if (fieldReason) {
    return mutualSentence ? `${mutualSentence} ${fieldReason}` : fieldReason;
  }
  if (mutualSentence) {
    return mutualSentence;
  }
  if (strongSimilarity) {
    return 'Your profiles look very similar.';
  }
  return 'Suggested connection based on active profile details.';
}

function buildFieldReason(
  matchingDetails: Array<{ field: string; value: string; label: string }>,
): string | null {
  const uni = matchingDetails.find((d) => d.field === 'university');
  const loc = matchingDetails.find((d) => d.field === 'location');
  const prof = matchingDetails.find((d) => d.field === 'profession');
  const work = matchingDetails.find((d) => d.field === 'work_place');
  const dept = matchingDetails.find((d) => d.field === 'department');
  const skills = matchingDetails.find((d) => d.field === 'skills');
  const ints = matchingDetails.find((d) => d.field === 'interests');

  const profExact = prof?.label === 'Same Profession';
  const profDesc = profExact ? `work as ${prof!.value}` : 'work in similar roles';

  if (uni && prof) {
    return profExact
      ? `You both study/studied at ${uni.value} and work as a ${prof.value}.`
      : `You both study/studied at ${uni.value} and work in similar roles.`;
  }
  if (work && prof) {
    return profExact
      ? `Both of you work as ${prof.value} at ${work.value}.`
      : `You both work in similar roles at ${work.value}.`;
  }
  if (uni && loc) {
    return `You both study/studied at ${uni.value} and live in ${loc.value}.`;
  }

  const parts: string[] = [];
  if (prof) parts.push(profDesc);
  if (work && !prof) parts.push(`work at ${work.value}`);
  if (uni) parts.push(`studied at ${uni.value}`);
  if (loc) parts.push(`live in ${loc.value}`);

  if (parts.length > 0) {
    let sentence = 'You both ' + parts.join(', ');
    const lastCommaIndex = sentence.lastIndexOf(',');
    if (lastCommaIndex !== -1 && parts.length > 1) {
      sentence =
        sentence.substring(0, lastCommaIndex) +
        ', and' +
        sentence.substring(lastCommaIndex + 1);
    }
    return sentence + '.';
  }

  if (skills) {
    return `You both share skills in: ${skills.value}.`;
  }
  if (ints) {
    return `You both share interests in: ${ints.value}.`;
  }
  if (dept) {
    return `Both of you study/work in the ${dept.value} department.`;
  }

  return null;
}

/** Split a comma-separated profile field into trimmed tokens. */
function splitTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Normalize a token for comparison: lowercase, alphanumerics only ("Node.js" → "nodejs"). */
function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Full list — for proper nouns (university/company/place names) where generic
// words like "software" or "tech" are filler, not meaning
const STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'ltd',
  'inc',
  'co',
  'corp',
  'at',
  'of',
  'in',
  'on',
  'with',
  'a',
  'an',
  'university',
  'department',
  'workplace',
  'company',
  'corporation',
  'institute',
  'school',
  'college',
  'tech',
  'technology',
  'science',
  'engineering',
  'solutions',
  'software',
  'systems',
  'group',
  'bangladesh',
  'north',
  'south',
  'east',
  'west',
  'national',
  'international',
  'city',
  'state',
  'public',
  'private',
]);

// Minimal list — for short semantic fields (profession, department) where
// domain words like "software", "engineering" or "tech" ARE the meaning
const MINIMAL_STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'at',
  'of',
  'in',
  'on',
  'with',
  'a',
  'an',
]);

function getFilteredWords(
  str: string,
  stopWords: Set<string> = STOP_WORDS,
): string[] {
  return str
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Prefix-aware token comparison so close word forms count as the same word:
 * "web" ↔ "website", "develop" ↔ "developer" ↔ "development".
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 3 && longer.startsWith(shorter);
}

function checkFieldOverlap(
  val1?: string | null,
  val2?: string | null,
  useMinimalStopWords = false,
): { matches: boolean; exact: boolean; matchedValue?: string } {
  if (!val1 || !val2) return { matches: false, exact: false };

  const v1 = val1.trim().toLowerCase();
  const v2 = val2.trim().toLowerCase();

  if (v1 === v2 || v1.includes(v2) || v2.includes(v1)) {
    return { matches: true, exact: true, matchedValue: val2 };
  }

  const stopWords = useMinimalStopWords ? MINIMAL_STOP_WORDS : STOP_WORDS;
  const words1 = getFilteredWords(val1, stopWords);
  const words2 = getFilteredWords(val2, stopWords);
  if (words1.length === 0 || words2.length === 0) {
    return { matches: false, exact: false };
  }

  const commonCount = words1.filter((w1) =>
    words2.some((w2) => tokensMatch(w1, w2)),
  ).length;
  const minLen = Math.min(words1.length, words2.length);

  // One shared word between long proper nouns is noise ("North South
  // University" vs "South East University"), but between short phrases it's
  // meaningful ("full stack developer" vs "website developer" share
  // "developer"). Accept ≥2 shared words, full coverage of one side
  // ("Dhaka University" vs "University of Dhaka"), or a single shared word
  // when either phrase has at most 2 significant words.
  const fullCoverage = commonCount === minLen;

  if (commonCount >= 2 || (commonCount >= 1 && (fullCoverage || minLen <= 2))) {
    return { matches: true, exact: false, matchedValue: val2 };
  }

  return { matches: false, exact: false };
}
