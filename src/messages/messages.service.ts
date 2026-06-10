import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// sanitize-html is a CommonJS module; use require for compatibility
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sanitizeHtml = require('sanitize-html') as (
  dirty: string,
  opts?: { allowedTags: string[]; allowedAttributes: Record<string, unknown> },
) => string;
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../common/enums/notification-type.enum.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { buildCursorPagination } from '../common/utils/pagination.util.js';

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  content: true,
  type: true,
  mediaUrl: true,
  mediaSize: true,
  mediaType: true,
  replyToId: true,
  editedAt: true,
  isDeleted: true,
  deletedAt: true,
  deletedFor: true,
  createdAt: true,
  updatedAt: true,
  sender: {
    select: { id: true, name: true, username: true, avatar: true },
  },
  replyTo: {
    select: {
      id: true,
      content: true,
      type: true,
      senderId: true,
      sender: { select: { id: true, name: true } },
    },
  },
  reads: {
    select: { userId: true, readAt: true },
  },
  reactions: {
    select: { userId: true, emoji: true, createdAt: true },
  },
};

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  private sanitize(content?: string): string | undefined {
    if (!content) return content;
    return sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} });
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    // Check block
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: dto.conversationId,
        members: { some: { userId } },
      },
      include: { members: { select: { userId: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.type === 'DIRECT') {
      const otherUserId = conversation.members.find(
        (m) => m.userId !== userId,
      )?.userId;
      if (otherUserId) {
        const block = await this.prisma.blockedUser.findFirst({
          where: {
            OR: [
              { blockedById: userId, blockedUserId: otherUserId },
              { blockedById: otherUserId, blockedUserId: userId },
            ],
          },
        });
        if (block)
          throw new ForbiddenException('Cannot send message to this user');
      }
    }

    const sanitizedContent = this.sanitize(dto.content);

    const message = await this.prisma.message.create({
      data: {
        conversationId: dto.conversationId,
        senderId: userId,
        content: sanitizedContent,
        type: dto.type,
        mediaUrl: dto.mediaUrl,
        mediaSize: dto.mediaSize,
        mediaType: dto.mediaType,
        replyToId: dto.replyToId,
      },
      select: MESSAGE_SELECT,
    });

    // Update conversation denormalized fields
    await this.prisma.conversation.update({
      where: { id: dto.conversationId },
      data: {
        lastMessageId: message.id,
        lastMessageAt: message.createdAt,
      },
    });

    // Notify other members
    const otherMembers = conversation.members.filter(
      (m) => m.userId !== userId,
    );
    await Promise.all(
      otherMembers.map((m) =>
        this.notificationsService.createNotification(
          m.userId,
          NotificationType.NEW_MESSAGE,
          message.sender.name,
          sanitizedContent ?? `Sent a ${dto.type.toLowerCase()}`,
          {
            conversationId: dto.conversationId,
            senderId: userId,
            messageId: message.id,
          },
        ),
      ),
    );

    return message;
  }

  async editMessage(messageId: string, userId: string, content: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId)
      throw new ForbiddenException('Not authorized');
    if (message.isDeleted)
      throw new ForbiddenException('Cannot edit deleted message');

    return this.prisma.message.update({
      where: { id: messageId },
      data: { content: this.sanitize(content), editedAt: new Date() },
      select: MESSAGE_SELECT,
    });
  }

  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId)
      throw new ForbiddenException('Not authorized');

    return this.prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true, deletedAt: new Date(), content: null },
      select: {
        id: true,
        conversationId: true,
        isDeleted: true,
        deletedAt: true,
      },
    });
  }

  async markAsRead(userId: string, conversationId: string, messageId: string) {
    const unreadMessages = await this.prisma.message.findMany({
      where: {
        conversationId,
        senderId: { not: userId },
        NOT: {
          reads: {
            some: { userId },
          },
        },
      },
      select: { id: true },
    });

    if (unreadMessages.length > 0) {
      await this.prisma.messageRead.createMany({
        data: unreadMessages.map((m) => ({
          messageId: m.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }

    return { messageId, userId, readAt: new Date() };
  }

  async reactToMessage(userId: string, messageId: string, emoji: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.isDeleted)
      throw new ForbiddenException('Cannot react to deleted message');

    return this.prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      create: { messageId, userId, emoji },
      update: {},
      select: { messageId: true, userId: true, emoji: true, createdAt: true },
    });
  }

  async removeReaction(userId: string, messageId: string, emoji: string) {
    await this.prisma.reaction.deleteMany({
      where: { messageId, userId, emoji },
    });
    return { removed: true };
  }

  async getMessages(
    conversationId: string,
    userId: string,
    cursor?: string,
    limit = 50,
  ) {
    // Verify membership
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member)
      throw new ForbiddenException('Not a member of this conversation');

    const pagination = buildCursorPagination(cursor, limit);

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        isDeleted: false,
        NOT: { deletedFor: { has: userId } },
      },
      ...pagination,
      select: MESSAGE_SELECT,
    });

    const nextCursor =
      messages.length === pagination.take
        ? messages[messages.length - 1].id
        : null;

    return {
      data: messages,
      nextCursor,
      hasMore: !!nextCursor,
    };
  }
}
