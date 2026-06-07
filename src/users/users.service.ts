/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

  async getSuggestions(userId: string, limit: number) {
    // 1. Get blocked user IDs
    const blocks = await this.prisma.blockedUser.findMany({
      where: {
        OR: [{ blockedById: userId }, { blockedUserId: userId }],
      },
      select: { blockedById: true, blockedUserId: true },
    });
    const blockedUserIds = blocks.map((b) =>
      b.blockedById === userId ? b.blockedUserId : b.blockedById,
    );

    // 2. Get friend IDs
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      select: { user1Id: true, user2Id: true },
    });
    const friendIds = friendships.map((f) =>
      f.user1Id === userId ? f.user2Id : f.user1Id,
    );

    // 3. Get pending requests user IDs
    const pendingRequests = await this.prisma.friendRequest.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: 'PENDING',
      },
      select: { senderId: true, receiverId: true },
    });
    const pendingUserIds = pendingRequests.map((r) =>
      r.senderId === userId ? r.receiverId : r.senderId,
    );

    // 4. Combine all IDs to exclude
    const excludeIds = [userId, ...blockedUserIds, ...friendIds, ...pendingUserIds];

    // 5. Fetch current user's profile details
    const currentUser = await this.prisma.user.findUnique({
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
    });

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    const userSkills = currentUser.skills
      ? currentUser.skills.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];
    const userInterests = currentUser.interests
      ? currentUser.interests.split(',').map((i) => i.trim().toLowerCase()).filter(Boolean)
      : [];

    // 6. Build query filters based on commonalities (word-based matching)
    const OR_conditions: any[] = [];
    
    const addWordConditions = (field: string, value: string | null) => {
      if (!value) return;
      const words = getFilteredWords(value);
      if (words.length === 0) {
        OR_conditions.push({ [field]: { contains: value, mode: 'insensitive' } });
      } else {
        words.forEach((word) => {
          OR_conditions.push({ [field]: { contains: word, mode: 'insensitive' } });
        });
      }
    };

    addWordConditions('location', currentUser.location);
    addWordConditions('university', currentUser.university);
    addWordConditions('department', currentUser.department);
    addWordConditions('profession', currentUser.profession);
    addWordConditions('work_place', currentUser.work_place);

    userSkills.forEach((skill) => {
      OR_conditions.push({ skills: { contains: skill, mode: 'insensitive' } });
    });

    userInterests.forEach((interest) => {
      OR_conditions.push({ interests: { contains: interest, mode: 'insensitive' } });
    });

    const fallbackConditions = [
      { location: { not: null } },
      { university: { not: null } },
      { profession: { not: null } },
    ];

    // 7. Query candidate suggestions
    const candidates = await this.prisma.user.findMany({
      where: {
        id: { notIn: excludeIds },
        OR: OR_conditions.length > 0 ? OR_conditions : fallbackConditions,
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
      take: 100,
    });

    // 8. Score, map matches, and sort
    const scoredCandidates = candidates.map((candidate) => {
      let score = 0;
      const matchingFields: string[] = [];
      const matchingDetails: Array<{ field: string; value: string; label: string }> = [];

      const uniMatch = checkFieldOverlap(currentUser.university, candidate.university);
      if (uniMatch.matches) {
        score += 20;
        matchingFields.push('university');
        matchingDetails.push({
          field: 'university',
          value: candidate.university!,
          label: 'Same University',
        });
      }

      const workMatch = checkFieldOverlap(currentUser.work_place, candidate.work_place);
      if (workMatch.matches) {
        score += 20;
        matchingFields.push('work_place');
        matchingDetails.push({
          field: 'work_place',
          value: candidate.work_place!,
          label: 'Same Workplace',
        });
      }

      const profMatch = checkFieldOverlap(currentUser.profession, candidate.profession);
      if (profMatch.matches) {
        score += 20;
        matchingFields.push('profession');
        matchingDetails.push({
          field: 'profession',
          value: candidate.profession!,
          label: 'Same Profession',
        });
      }

      const locMatch = checkFieldOverlap(currentUser.location, candidate.location);
      if (locMatch.matches) {
        score += 15;
        matchingFields.push('location');
        matchingDetails.push({
          field: 'location',
          value: candidate.location!,
          label: 'Same Location',
        });
      }

      const deptMatch = checkFieldOverlap(currentUser.department, candidate.department);
      if (deptMatch.matches) {
        score += 10;
        matchingFields.push('department');
        matchingDetails.push({
          field: 'department',
          value: candidate.department!,
          label: 'Same Department',
        });
      }

      if (candidate.skills) {
        const candSkills = candidate.skills.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        const commonSkills = userSkills.filter((skill) => candSkills.includes(skill));
        if (commonSkills.length > 0) {
          score += Math.min(15, commonSkills.length * 5);
          matchingFields.push('skills');
          matchingDetails.push({
            field: 'skills',
            value: commonSkills.join(', '),
            label: `Shared Skills`,
          });
        }
      }

      if (candidate.interests) {
        const candInterests = candidate.interests.split(',').map((i) => i.trim().toLowerCase()).filter(Boolean);
        const commonInterests = userInterests.filter((interest) => candInterests.includes(interest));
        if (commonInterests.length > 0) {
          score += Math.min(10, commonInterests.length * 5);
          matchingFields.push('interests');
          matchingDetails.push({
            field: 'interests',
            value: commonInterests.join(', '),
            label: `Shared Interests`,
          });
        }
      }

      score = Math.min(100, score);

      if (score === 0) {
        score = 40 + (candidate.name.charCodeAt(0) % 10);
      }

      const reason = buildMatchReason(matchingDetails, candidate);

      return {
        ...candidate,
        matchScore: score,
        matchReason: reason,
        matchingFields,
        matchingDetails,
      };
    });

    scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);
    return scoredCandidates.slice(0, limit);
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
  candidate: any,
): string {
  const uni = matchingDetails.find((d) => d.field === 'university');
  const loc = matchingDetails.find((d) => d.field === 'location');
  const prof = matchingDetails.find((d) => d.field === 'profession');
  const work = matchingDetails.find((d) => d.field === 'work_place');
  const dept = matchingDetails.find((d) => d.field === 'department');
  const skills = matchingDetails.find((d) => d.field === 'skills');
  const ints = matchingDetails.find((d) => d.field === 'interests');

  if (uni && prof) {
    return `You both study/studied at ${uni.value} and work as a ${prof.value}.`;
  }
  if (work && prof) {
    return `Both of you work as ${prof.value} at ${work.value}.`;
  }
  if (uni && loc) {
    return `You both study/studied at ${uni.value} and live in ${loc.value}.`;
  }

  const parts: string[] = [];
  if (prof) parts.push(`work as ${prof.value}`);
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

  return 'Suggested connection based on active profile details.';
}

function getFilteredWords(str: string): string[] {
  const STOP_WORDS = new Set([
    'and', 'the', 'for', 'ltd', 'inc', 'co', 'corp', 'at', 'of', 'in', 'on', 'with', 'a', 'an',
    'university', 'department', 'workplace', 'company', 'corporation', 'institute', 'school', 'college',
    'tech', 'technology', 'science', 'engineering', 'solutions', 'software', 'systems', 'group', 'bangladesh'
  ]);
  return str
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function checkFieldOverlap(val1?: string | null, val2?: string | null): { matches: boolean; matchedValue?: string } {
  if (!val1 || !val2) return { matches: false };
  
  const v1 = val1.trim().toLowerCase();
  const v2 = val2.trim().toLowerCase();
  
  if (v1 === v2 || v1.includes(v2) || v2.includes(v1)) {
    return { matches: true, matchedValue: val2 };
  }
  
  const words1 = getFilteredWords(val1);
  const words2 = getFilteredWords(val2);
  const commonWords = words1.filter((w) => words2.includes(w));
  
  if (commonWords.length > 0) {
    return { matches: true, matchedValue: val2 };
  }
  
  return { matches: false };
}


