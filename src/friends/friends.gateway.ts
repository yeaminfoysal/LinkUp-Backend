import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseFilters, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { WsExceptionFilter } from '../common/filters/ws-exception.filter';
import { FriendsService } from './friends.service';
import { SocketStateService } from '../sockets/socket-state.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({ cors: { origin: '*' } })
@UseGuards(WsJwtGuard)
@UseFilters(WsExceptionFilter)
export class FriendsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly friendsService: FriendsService,
    private readonly socketState: SocketStateService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) { }

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization?.replace('Bearer ', '') ?? '');
      if (!token) {
        client.disconnect();
        return;
      }
      
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      const userId = payload.sub as string;
      client.data.userId = userId;
      client.data.email = payload.email as string;
      this.socketState.addSocket(userId, client.id);
      await client.join(`user:${userId}`);
      await this.usersService.setOnlineStatus(userId, true);
      this.server.emit('user_online', { userId });

      console.log(`✅ User connected: ${userId}`);
    } catch (error) {
      console.log('❌ Connection unauthorized');
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;

    this.socketState.removeSocket(userId, client.id);

    if (!this.socketState.isOnline(userId)) {
      const user = await this.usersService.setOnlineStatus(userId, false);
      this.server.emit('user_offline', { userId, lastSeen: user.lastSeen });
    }
  }

  @SubscribeMessage('send_friend_request')
  async sendFriendRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId: string },
  ) {
    const senderId = client.data.userId as string;
    const request = await this.friendsService.sendRequest(senderId, data.receiverId);

    // Notify receiver in real-time
    this.server.to(`user:${data.receiverId}`).emit('friend_request_received', {
      requestId: request.id,
      sender: request.sender,
    });

    return { event: 'friend_request_sent', data: request };
  }

  @SubscribeMessage('accept_friend_request')
  async acceptFriendRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { requestId: string },
  ) {
    const userId = client.data.userId as string;
    const result = await this.friendsService.acceptRequest(data.requestId, userId);

    // Notify the original sender
    this.server.to(`user:${result.request.senderId}`).emit('friend_request_accepted', {
      requestId: result.request.id,
      acceptedBy: result.sender,
    });

    return { event: 'friend_request_accepted', data: result };
  }

  @SubscribeMessage('reject_friend_request')
  async rejectFriendRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { requestId: string },
  ) {
    const userId = client.data.userId as string;
    const request = await this.friendsService.rejectRequest(data.requestId, userId);

    this.server.to(`user:${request.senderId}`).emit('friend_request_rejected', {
      requestId: request.id,
    });

    return { event: 'friend_request_rejected', data: request };
  }

  @SubscribeMessage('cancel_friend_request')
  async cancelFriendRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { requestId: string },
  ) {
    const userId = client.data.userId as string;
    const request = await this.friendsService.cancelRequest(data.requestId, userId);

    this.server.to(`user:${request.receiverId}`).emit('friend_request_cancelled', {
      requestId: request.id,
    });

    return { event: 'friend_request_cancelled', data: request };
  }

  @SubscribeMessage('remove_friend')
  async removeFriend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { friendshipId: string },
  ) {
    const userId = client.data.userId as string;
    const result = await this.friendsService.removeFriend(data.friendshipId, userId);

    this.server.to(`user:${userId}`).emit('friend_removed', { friendshipId: data.friendshipId });

    return { event: 'friend_removed', data: result };
  }

  @SubscribeMessage('block_user')
  async blockUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const blockerId = client.data.userId as string;
    const block = await this.friendsService.blockUser(blockerId, data.userId);

    this.server.to(`user:${data.userId}`).emit('user_blocked', { blockedBy: blockerId });

    return { event: 'user_blocked', data: block };
  }

  @SubscribeMessage('unblock_user')
  async unblockUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const blockerId = client.data.userId as string;
    const result = await this.friendsService.unblockUser(blockerId, data.userId);

    this.server.to(`user:${data.userId}`).emit('user_unblocked', { unblockedBy: blockerId });

    return { event: 'user_unblocked', data: result };
  }

  @SubscribeMessage('ping_presence')
  pingPresence(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string;
    return { event: 'presence_updated', data: { userId, isOnline: true } };
  }
}
