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
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';

@WebSocketGateway({ cors: { origin: '*' } })
@UseGuards(WsJwtGuard)
@UseFilters(WsExceptionFilter)
export class MessagesGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly messagesService: MessagesService) {}

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SendMessageDto,
  ) {
    const userId = client.data.userId as string;
    const message = await this.messagesService.sendMessage(userId, dto);

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('new_message', { message });

    return { event: 'message_sent', data: message };
  }

  @SubscribeMessage('edit_message')
  async editMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string; content: string },
  ) {
    const userId = client.data.userId as string;
    const updated = await this.messagesService.editMessage(
      data.messageId,
      userId,
      data.content,
    );

    this.server
      .to(`conversation:${updated.conversationId}`)
      .emit('message_edited', {
        messageId: updated.id,
        content: updated.content,
        editedAt: updated.editedAt,
      });

    return { event: 'message_edited', data: updated };
  }

  @SubscribeMessage('delete_message')
  async deleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    const userId = client.data.userId as string;
    const deleted = await this.messagesService.deleteMessage(
      data.messageId,
      userId,
    );

    this.server
      .to(`conversation:${deleted.conversationId}`)
      .emit('message_deleted', {
        messageId: deleted.id,
        conversationId: deleted.conversationId,
      });

    return { event: 'message_deleted', data: deleted };
  }

  @SubscribeMessage('mark_as_read')
  async markAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; messageId: string },
  ) {
    const userId = client.data.userId as string;
    const read = await this.messagesService.markAsRead(
      userId,
      data.conversationId,
      data.messageId,
    );

    this.server.to(`conversation:${data.conversationId}`).emit('message_read', {
      messageId: read.messageId,
      readBy: read.userId,
      readAt: read.readAt,
    });

    return { event: 'message_read', data: read };
  }

  @SubscribeMessage('typing_start')
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId as string;
    client
      .to(`conversation:${data.conversationId}`)
      .emit('user_typing', { userId, conversationId: data.conversationId });
  }

  @SubscribeMessage('typing_stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId as string;
    client
      .to(`conversation:${data.conversationId}`)
      .emit('user_stop_typing', {
        userId,
        conversationId: data.conversationId,
      });
  }

  @SubscribeMessage('react_to_message')
  async reactToMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string; emoji: string },
  ) {
    const userId = client.data.userId as string;
    const reaction = await this.messagesService.reactToMessage(
      userId,
      data.messageId,
      data.emoji,
    );

    // Find conversation to emit to the room
    const message = await this.messagesService['prisma'].message.findUnique({
      where: { id: data.messageId },
      select: { conversationId: true },
    });

    if (message) {
      this.server
        .to(`conversation:${message.conversationId}`)
        .emit('message_reacted', {
          messageId: data.messageId,
          userId,
          emoji: data.emoji,
        });
    }

    return { event: 'message_reacted', data: reaction };
  }

  @SubscribeMessage('remove_reaction')
  async removeReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string; emoji: string },
  ) {
    const userId = client.data.userId as string;

    const message = await this.messagesService['prisma'].message.findUnique({
      where: { id: data.messageId },
      select: { conversationId: true },
    });

    await this.messagesService.removeReaction(
      userId,
      data.messageId,
      data.emoji,
    );

    if (message) {
      this.server
        .to(`conversation:${message.conversationId}`)
        .emit('reaction_removed', {
          messageId: data.messageId,
          userId,
          emoji: data.emoji,
        });
    }

    return { event: 'reaction_removed', data: { removed: true } };
  }
}
