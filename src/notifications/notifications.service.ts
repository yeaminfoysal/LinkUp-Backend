import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketStateService } from '../sockets/socket-state.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationType } from '../common/enums/notification-type.enum';
import { buildOffsetPagination } from '../common/utils/pagination.util';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private socketState: SocketStateService,
    private notificationsGateway: NotificationsGateway,
  ) {}

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: any,
  ) {
    const notification = await this.prisma.notification.create({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { userId, type, title, body, data },
    });

    // Emit real-time if user is online
    if (this.socketState.isOnline(userId)) {
      this.notificationsGateway.emitNotification(userId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        createdAt: notification.createdAt,
      });
    }

    return notification;
  }

  async getNotifications(userId: string, page = 1, limit = 20) {
    const { take, skip } = buildOffsetPagination(page, limit);
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    // eslint-disable-next-line prettier/prettier
    if (notification.userId !== userId)
      throw new NotFoundException('Notification not found');

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'All notifications marked as read' };
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }
}
