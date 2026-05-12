import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDirectDto } from './dto/create-direct.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { buildOffsetPagination } from '../common/utils/pagination.util';
import { ConversationsGateway } from './conversations.gateway';

const MEMBER_SELECT = {
  id: true,
  userId: true,
  role: true,
  joinedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      username: true,
      avatar: true,
      isOnline: true,
      lastSeen: true,
    },
  },
};

const CONVERSATION_SELECT = {
  id: true,
  type: true,
  name: true,
  avatar: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  lastMessageId: true,
  lastMessageAt: true,
  members: { select: MEMBER_SELECT },
};

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ConversationsGateway))
    private readonly conversationsGateway: ConversationsGateway,
  ) {}

  async createDirectConversation(userId: string, dto: CreateDirectDto) {
    const { targetUserId } = dto;

    // Check block
    const block = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockedById: userId, blockedUserId: targetUserId },
          { blockedById: targetUserId, blockedUserId: userId },
        ],
      },
    });
    if (block) throw new ForbiddenException('Cannot create conversation with this user');

    // Check existing direct conversation
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { members: { some: { userId } } },
          { members: { some: { userId: targetUserId } } },
        ],
      },
      select: CONVERSATION_SELECT,
    });
    if (existing) return existing;

    const conversation = await this.prisma.conversation.create({
      data: {
        type: 'DIRECT',
        createdById: userId,
        members: {
          create: [
            { userId, role: 'MEMBER' },
            { userId: targetUserId, role: 'MEMBER' },
          ],
        },
      },
      select: CONVERSATION_SELECT,
    });

    // Notify members via socket
    conversation.members.forEach((member) => {
      this.conversationsGateway.server
        .to(`user:${member.userId}`)
        .emit('conversation_created', { conversation });
    });

    return conversation;
  }

  async createGroupConversation(userId: string, dto: CreateGroupDto) {
    const memberIds = [...new Set([...dto.memberIds, userId])];

    const conversation = await this.prisma.conversation.create({
      data: {
        type: 'GROUP',
        name: dto.name,
        avatar: dto.avatar,
        createdById: userId,
        members: {
          create: memberIds.map((mid) => ({
            userId: mid,
            role: mid === userId ? 'ADMIN' : 'MEMBER',
          })),
        },
      },
      select: CONVERSATION_SELECT,
    });

    // Notify members via socket
    conversation.members.forEach((member) => {
      this.conversationsGateway.server
        .to(`user:${member.userId}`)
        .emit('conversation_created', { conversation });
    });

    return conversation;
  }

  async getConversations(userId: string, page = 1, limit = 20) {
    const { take, skip } = buildOffsetPagination(page, limit);

    return this.prisma.conversation.findMany({
      where: {
        members: { some: { userId } },
      },
      select: {
        ...CONVERSATION_SELECT,
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            type: true,
            senderId: true,
            createdAt: true,
          },
        },
      },
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take,
      skip,
    });
  }

  async getConversationById(id: string, userId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: {
        id,
        members: { some: { userId } },
      },
      select: CONVERSATION_SELECT,
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return conv;
  }

  async ensureMember(conversationId: string, userId: string) {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this conversation');
    return member;
  }

  async ensureAdmin(conversationId: string, userId: string) {
    const member = await this.ensureMember(conversationId, userId);
    if (member.role !== 'ADMIN') throw new ForbiddenException('Admin only');
    return member;
  }

  async addMembers(conversationId: string, userId: string, memberIds: string[]) {
    await this.ensureAdmin(conversationId, userId);

    const data = memberIds.map((mid) => ({
      conversationId,
      userId: mid,
      role: 'MEMBER' as const,
    }));

    await this.prisma.conversationMember.createMany({
      data,
      skipDuplicates: true,
    });

    const newMembers = await this.prisma.conversationMember.findMany({
      where: { conversationId, userId: { in: memberIds } },
      select: MEMBER_SELECT,
    });

    return newMembers;
  }

  async removeMember(conversationId: string, adminId: string, targetUserId: string) {
    await this.ensureAdmin(conversationId, adminId);

    await this.prisma.conversationMember.deleteMany({
      where: { conversationId, userId: targetUserId },
    });

    return { removed: targetUserId };
  }

  async leaveConversation(conversationId: string, userId: string) {
    const member = await this.ensureMember(conversationId, userId);

    if (member.role === 'ADMIN') {
      // Transfer admin to another member
      const nextMember = await this.prisma.conversationMember.findFirst({
        where: { conversationId, userId: { not: userId } },
        orderBy: { joinedAt: 'asc' },
      });
      if (nextMember) {
        await this.prisma.conversationMember.update({
          where: { id: nextMember.id },
          data: { role: 'ADMIN' },
        });
      }
    }

    await this.prisma.conversationMember.deleteMany({
      where: { conversationId, userId },
    });

    return { left: userId };
  }

  async deleteGroup(conversationId: string, userId: string) {
    await this.ensureAdmin(conversationId, userId);
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    return { deleted: conversationId };
  }

  async updateGroup(
    conversationId: string,
    userId: string,
    name?: string,
    avatar?: string,
  ) {
    await this.ensureAdmin(conversationId, userId);

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(name && { name }),
        ...(avatar && { avatar }),
      },
      select: CONVERSATION_SELECT,
    });
  }

  async promoteToAdmin(conversationId: string, adminId: string, targetUserId: string) {
    await this.ensureAdmin(conversationId, adminId);

    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
      data: { role: 'ADMIN' },
    });

    return { promoted: targetUserId };
  }

  async demoteAdmin(conversationId: string, adminId: string, targetUserId: string) {
    await this.ensureAdmin(conversationId, adminId);

    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
      data: { role: 'MEMBER' },
    });

    return { demoted: targetUserId };
  }
}
