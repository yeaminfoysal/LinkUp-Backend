import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../common/enums/notification-type.enum';
import { FriendsGateway } from './friends.gateway';

const FRIEND_USER_SELECT = {
  id: true,
  name: true,
  username: true,
  avatar: true,
  isOnline: true,
  lastSeen: true,
};

@Injectable()
export class FriendsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    @Inject(forwardRef(() => FriendsGateway))
    private readonly friendsGateway: FriendsGateway,
  ) {}

  async sendRequest(senderId: string, receiverId: string) {
    if (senderId === receiverId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    // Check if receiver exists
    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: FRIEND_USER_SELECT,
    });
    if (!receiver) throw new NotFoundException('User not found');

    // Check block
    const block = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockedById: senderId, blockedUserId: receiverId },
          { blockedById: receiverId, blockedUserId: senderId },
        ],
      },
    });
    if (block) throw new ForbiddenException('Cannot send friend request');

    // Check already friends
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: senderId, user2Id: receiverId },
          { user1Id: receiverId, user2Id: senderId },
        ],
      },
    });
    if (friendship) throw new ConflictException('Already friends');

    // Check existing request
    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
        status: 'PENDING',
      },
    });
    if (existing) throw new ConflictException('Friend request already exists');

    const request = await this.prisma.friendRequest.create({
      data: { senderId, receiverId, status: 'PENDING' },
      include: {
        sender: { select: FRIEND_USER_SELECT },
        receiver: { select: FRIEND_USER_SELECT },
      },
    });

    // Create database notification and trigger socket event
    await this.notificationsService.createNotification(
      receiverId,
      NotificationType.FRIEND_REQUEST,
      'New Friend Request',
      `${request.sender.name} sent you a friend request.`,
      { requestId: request.id, senderId },
    );

    // Emit direct socket event
    if (this.friendsGateway.server) {
      this.friendsGateway.server
        .to(`user:${receiverId}`)
        .emit('friend_request_received', {
          requestId: request.id,
          sender: request.sender,
        });
    }

    return request;
  }

  async acceptRequest(requestId: string, userId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
      include: { sender: { select: FRIEND_USER_SELECT } },
    });

    if (!request) throw new NotFoundException('Friend request not found');
    if (request.receiverId !== userId)
      throw new ForbiddenException('Not authorized');
    if (request.status !== 'PENDING')
      throw new BadRequestException('Request is not pending');

    const [updatedRequest, friendship] = await this.prisma.$transaction([
      this.prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' },
      }),
      this.prisma.friendship.create({
        data: { user1Id: request.senderId, user2Id: userId },
      }),
    ]);

    // Create database notification and trigger socket event
    await this.notificationsService.createNotification(
      request.senderId,
      NotificationType.FRIEND_ACCEPTED,
      'Friend Request Accepted',
      `${request.sender.name} accepted your friend request.`,
      { friendshipId: friendship.id, receiverId: userId },
    );

    // Emit direct socket event
    if (this.friendsGateway.server) {
      this.friendsGateway.server
        .to(`user:${request.senderId}`)
        .emit('friend_request_accepted', {
          requestId: request.id,
          acceptedBy: request.sender,
        });
    }

    return { request: updatedRequest, friendship, sender: request.sender };
  }

  async rejectRequest(requestId: string, userId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Friend request not found');
    if (request.receiverId !== userId)
      throw new ForbiddenException('Not authorized');

    const updated = await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' },
    });

    if (this.friendsGateway.server) {
      this.friendsGateway.server
        .to(`user:${request.senderId}`)
        .emit('friend_request_rejected', {
          requestId: request.id,
        });
    }

    return updated;
  }

  async cancelRequest(requestId: string, userId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Friend request not found');
    if (request.senderId !== userId)
      throw new ForbiddenException('Not authorized');

    const deleted = await this.prisma.friendRequest.delete({
      where: { id: requestId },
    });

    if (this.friendsGateway.server) {
      this.friendsGateway.server
        .to(`user:${request.receiverId}`)
        .emit('friend_request_cancelled', {
          requestId: request.id,
        });
    }

    return deleted;
  }

  async removeFriend(friendshipId: string, userId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!friendship) throw new NotFoundException('Friendship not found');
    if (friendship.user1Id !== userId && friendship.user2Id !== userId) {
      throw new ForbiddenException('Not authorized');
    }

    await this.prisma.friendship.delete({ where: { id: friendshipId } });

    const otherUserId =
      friendship.user1Id === userId ? friendship.user2Id : friendship.user1Id;
    if (this.friendsGateway.server) {
      this.friendsGateway.server
        .to(`user:${userId}`)
        .emit('friend_removed', { friendshipId });
      this.friendsGateway.server
        .to(`user:${otherUserId}`)
        .emit('friend_removed', { friendshipId });
    }

    return { message: 'Friend removed' };
  }

  async blockUser(blockerId: string, targetId: string) {
    if (blockerId === targetId)
      throw new BadRequestException('Cannot block yourself');

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });
    if (!target) throw new NotFoundException('User not found');

    const existing = await this.prisma.blockedUser.findUnique({
      where: {
        blockedById_blockedUserId: {
          blockedById: blockerId,
          blockedUserId: targetId,
        },
      },
    });
    if (existing) throw new ConflictException('User already blocked');

    // Remove friendship if exists
    await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { user1Id: blockerId, user2Id: targetId },
          { user1Id: targetId, user2Id: blockerId },
        ],
      },
    });

    // Remove all friend requests (any status) between the two users
    await this.prisma.friendRequest.deleteMany({
      where: {
        OR: [
          { senderId: blockerId, receiverId: targetId },
          { senderId: targetId, receiverId: blockerId },
        ],
      },
    });

    const blocked = await this.prisma.blockedUser.create({
      data: { blockedById: blockerId, blockedUserId: targetId },
    });

    if (this.friendsGateway.server) {
      this.friendsGateway.server
        .to(`user:${targetId}`)
        .emit('user_blocked', { blockedBy: blockerId });
    }

    return blocked;
  }

  async unblockUser(blockerId: string, targetId: string) {
    const block = await this.prisma.blockedUser.findUnique({
      where: {
        blockedById_blockedUserId: {
          blockedById: blockerId,
          blockedUserId: targetId,
        },
      },
    });
    if (!block) throw new NotFoundException('Block not found');

    const deleted = await this.prisma.blockedUser.delete({
      where: {
        blockedById_blockedUserId: {
          blockedById: blockerId,
          blockedUserId: targetId,
        },
      },
    });

    if (this.friendsGateway.server) {
      this.friendsGateway.server
        .to(`user:${targetId}`)
        .emit('user_unblocked', { unblockedBy: blockerId });
    }

    return deleted;
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      include: {
        user1: { select: FRIEND_USER_SELECT },
        user2: { select: FRIEND_USER_SELECT },
      },
    });

    return friendships.map((f) => ({
      friendshipId: f.id,
      friend: f.user1Id === userId ? f.user2 : f.user1,
      since: f.createdAt,
    }));
  }

  async getPendingRequests(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      include: { sender: { select: FRIEND_USER_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSentRequests(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: { senderId: userId, status: 'PENDING' },
      include: { receiver: { select: FRIEND_USER_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBlockedUsers(userId: string) {
    const blocks = await this.prisma.blockedUser.findMany({
      where: { blockedById: userId },
      include: {
        blockedUser: { select: FRIEND_USER_SELECT },
      },
    });
    return blocks.map((b) => b.blockedUser);
  }
}
