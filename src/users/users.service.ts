/* eslint-disable prettier/prettier */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchUserDto } from './dto/search-user.dto';
import { buildOffsetPagination } from '../common/utils/pagination.util';

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  avatar: true,
  bio: true,
  isOnline: true,
  lastSeen: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.avatar !== undefined && { avatar: dto.avatar }),
      },
      select: USER_SELECT,
    });
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
          // { id: { not: requesterId } },
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
        OR: [
          { blockedById: userId },
          { blockedUserId: userId },
        ],
      },
      select: {
        blockedById: true,
        blockedUserId: true,
      },
    });
    const blockedUserIds = blocks.map((b) =>
      b.blockedById === userId ? b.blockedUserId : b.blockedById,
    );

    // 2. Get friend IDs
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { user1Id: userId },
          { user2Id: userId },
        ],
      },
      select: {
        user1Id: true,
        user2Id: true,
      },
    });
    const friendIds = friendships.map((f) =>
      f.user1Id === userId ? f.user2Id : f.user1Id,
    );

    // 3. Get pending requests user IDs
    const pendingRequests = await this.prisma.friendRequest.findMany({
      where: {
        OR: [
          { senderId: userId },
          { receiverId: userId },
        ],
        status: 'PENDING',
      },
      select: {
        senderId: true,
        receiverId: true,
      },
    });
    const pendingUserIds = pendingRequests.map((r) =>
      r.senderId === userId ? r.receiverId : r.senderId,
    );

    // 4. Combine all IDs to exclude
    const excludeIds = [userId, ...blockedUserIds, ...friendIds, ...pendingUserIds];

    // 5. Query suggestions
    const suggestions = await this.prisma.user.findMany({
      where: {
        id: {
          notIn: excludeIds,
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        isOnline: true,
        lastSeen: true,
      },
      take: limit,
    });

    return suggestions;
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
