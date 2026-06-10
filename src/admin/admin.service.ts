import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendRequestStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getAllUsers(
    sortBy: 'lastSeen' | 'createdAt' = 'lastSeen',
    order: 'asc' | 'desc' = 'desc',
  ) {
    const users = await this.prisma.user.findMany({
      orderBy: {
        [sortBy]: order,
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatar: true,
        isOnline: true,
        lastSeen: true,
        createdAt: true,
        role: true,
        _count: {
          select: {
            posts: true,
            postLikes: true,
            comments: true,
            conversations: true,
          },
        },
        sentFriendRequests: {
          where: { status: FriendRequestStatus.PENDING },
          select: { id: true },
        },
        friendships1: { select: { id: true } },
        friendships2: { select: { id: true } },
      },
    });

    return users.map((user) => {
      const {
        sentFriendRequests,
        friendships1,
        friendships2,
        _count,
        ...rest
      } = user;
      return {
        ...rest,
        postsCount: _count.posts,
        likesCount: _count.postLikes,
        commentsCount: _count.comments,
        conversationsCount: _count.conversations,
        pendingRequestsCount: sentFriendRequests.length,
        friendsCount: friendships1.length + friendships2.length,
      };
    });
  }

  async getUserFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      include: {
        user1: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
            isOnline: true,
          },
        },
        user2: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
            isOnline: true,
          },
        },
      },
    });

    return friendships.map((f) => {
      const friend = f.user1Id === userId ? f.user2 : f.user1;
      return {
        friendshipId: f.id,
        createdAt: f.createdAt,
        ...friend,
      };
    });
  }

  async getUserPendingRequests(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: {
        senderId: userId,
        status: FriendRequestStatus.PENDING,
      },
      include: {
        receiver: {
          select: { id: true, name: true, username: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserConversations(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                    avatar: true,
                  },
                },
              },
            },
            lastMessage: {
              select: { content: true, createdAt: true, type: true },
            },
          },
        },
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });

    return memberships.map((m) => m.conversation);
  }

  async getConversationMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversationId },
      include: {
        sender: {
          select: { id: true, name: true, username: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit for admin view
    });
  }
}
