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

    // 5. Query suggestions
    const suggestions = await this.prisma.user.findMany({
      where: { id: { notIn: excludeIds } },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        bio: true,
        location: true,
        profession: true,
        isOnline: true,
        lastSeen: true,
      },
      take: limit,
    });

    return suggestions;
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
