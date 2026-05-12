import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseFilters, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../common/guards/ws-jwt.guard';
import { WsExceptionFilter } from '../common/filters/ws-exception.filter';
import { ConversationsService } from './conversations.service';
import { forwardRef, Inject } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
@UseGuards(WsJwtGuard)
@UseFilters(WsExceptionFilter)
export class ConversationsGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => ConversationsService))
    private readonly conversationsService: ConversationsService,
  ) {}

  @SubscribeMessage('join_conversation')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId as string;
    // Verify membership before joining room
    await this.conversationsService.ensureMember(data.conversationId, userId);
    client.join(`conversation:${data.conversationId}`);
    return { event: 'joined', data: { conversationId: data.conversationId } };
  }

  @SubscribeMessage('leave_conversation')
  leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    client.leave(`conversation:${data.conversationId}`);
    return { event: 'left', data: { conversationId: data.conversationId } };
  }

  @SubscribeMessage('add_group_members')
  async addGroupMembers(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; memberIds: string[] },
  ) {
    const userId = client.data.userId as string;
    const newMembers = await this.conversationsService.addMembers(
      data.conversationId,
      userId,
      data.memberIds,
    );

    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('group_member_added', {
        conversationId: data.conversationId,
        members: newMembers.map((m) => m.user),
      });

    return { event: 'group_member_added', data: newMembers };
  }

  @SubscribeMessage('remove_group_member')
  async removeGroupMember(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const adminId = client.data.userId as string;
    await this.conversationsService.removeMember(
      data.conversationId,
      adminId,
      data.userId,
    );

    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('group_member_removed', {
        conversationId: data.conversationId,
        userId: data.userId,
      });

    return { event: 'group_member_removed', data: { userId: data.userId } };
  }

  @SubscribeMessage('promote_to_admin')
  async promoteToAdmin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const adminId = client.data.userId as string;
    await this.conversationsService.promoteToAdmin(
      data.conversationId,
      adminId,
      data.userId,
    );

    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('group_admin_promoted', {
        conversationId: data.conversationId,
        userId: data.userId,
      });

    return { event: 'group_admin_promoted', data: { userId: data.userId } };
  }

  @SubscribeMessage('demote_admin')
  async demoteAdmin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; userId: string },
  ) {
    const adminId = client.data.userId as string;
    await this.conversationsService.demoteAdmin(
      data.conversationId,
      adminId,
      data.userId,
    );

    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('group_admin_demoted', {
        conversationId: data.conversationId,
        userId: data.userId,
      });

    return { event: 'group_admin_demoted', data: { userId: data.userId } };
  }

  @SubscribeMessage('update_group_name')
  async updateGroupName(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; name: string },
  ) {
    const userId = client.data.userId as string;
    const updated = await this.conversationsService.updateGroup(
      data.conversationId,
      userId,
      data.name,
    );

    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('group_updated', {
        conversationId: data.conversationId,
        name: updated.name,
        avatar: updated.avatar,
      });

    return { event: 'group_updated', data: updated };
  }

  @SubscribeMessage('update_group_avatar')
  async updateGroupAvatar(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; avatar: string },
  ) {
    const userId = client.data.userId as string;
    const updated = await this.conversationsService.updateGroup(
      data.conversationId,
      userId,
      undefined,
      data.avatar,
    );

    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('group_updated', {
        conversationId: data.conversationId,
        name: updated.name,
        avatar: updated.avatar,
      });

    return { event: 'group_updated', data: updated };
  }

  @SubscribeMessage('leave_group')
  async leaveGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId as string;
    await this.conversationsService.leaveConversation(data.conversationId, userId);

    client.leave(`conversation:${data.conversationId}`);
    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('group_member_removed', {
        conversationId: data.conversationId,
        userId,
      });

    return { event: 'conversation_left', data: { conversationId: data.conversationId } };
  }

  @SubscribeMessage('delete_group')
  async deleteGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId as string;
    await this.conversationsService.deleteGroup(data.conversationId, userId);

    this.server
      .to(`conversation:${data.conversationId}`)
      .emit('group_deleted', { conversationId: data.conversationId });

    return { event: 'group_deleted', data: { conversationId: data.conversationId } };
  }
}
