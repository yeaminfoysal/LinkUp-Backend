import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../common/enums/notification-type.enum';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createComment(userId: string, postId: string, createCommentDto: CreateCommentDto) {
    const post = await this.prisma.post.findUnique({ where: { id: postId, isDeleted: false } });
    if (!post) throw new NotFoundException('Post not found');

    if (createCommentDto.parentId) {
      const parent = await this.prisma.postComment.findUnique({
        where: { id: createCommentDto.parentId, isDeleted: false },
      });
      if (!parent) throw new NotFoundException('Parent comment not found');
    }

    const comment = await this.prisma.postComment.create({
      data: {
        userId,
        postId,
        content: createCommentDto.content,
        parentId: createCommentDto.parentId || null,
      },
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true } },
      },
    });

    // Notify post owner
    if (post.userId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await this.notificationsService.createNotification(
          post.userId,
          NotificationType.POST_COMMENTED,
          user.name,
          `${user.name} commented on your post`,
          { postId, commentId: comment.id, commentedBy: userId }
        );

        this.notificationsGateway.emitPostCommented(post.userId, {
          postId,
          comment,
        });
      }
    }

    return comment;
  }

  async getCommentsByPost(postId: string, cursor?: string, limit = 20) {
    const comments = await this.prisma.postComment.findMany({
      where: { postId, isDeleted: false, parentId: null },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true } },
        _count: { select: { likes: true, replies: { where: { isDeleted: false } } } },
      },
    });

    const hasNextPage = comments.length > limit;
    const items = hasNextPage ? comments.slice(0, -1) : comments;
    const nextCursor = hasNextPage ? items[items.length - 1].id : null;

    return { items, nextCursor, hasNextPage };
  }
  
  async deleteComment(userId: string, id: string) {
    const comment = await this.prisma.postComment.findUnique({ where: { id } });
    if (!comment || comment.isDeleted) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException('You can only delete your own comment');

    await this.prisma.postComment.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    const post = await this.prisma.post.findUnique({ where: { id: comment.postId } });
    if (post && post.userId !== userId) {
      this.notificationsGateway.emitPostCommentDeleted(post.userId, { postId: comment.postId, commentId: id });
    }

    return { message: 'Comment deleted' };
  }

  async likeComment(userId: string, id: string) {
    const comment = await this.prisma.postComment.findUnique({ where: { id, isDeleted: false } });
    if (!comment) throw new NotFoundException('Comment not found');

    const existingLike = await this.prisma.postCommentLike.findUnique({
      where: { commentId_userId: { commentId: id, userId } },
    });
    if (existingLike) return { message: 'Already liked' };

    await this.prisma.postCommentLike.create({ data: { commentId: id, userId } });

    // Notify comment owner
    if (comment.userId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await this.notificationsService.createNotification(
          comment.userId,
          NotificationType.POST_COMMENT_LIKED,
          user.name,
          `${user.name} liked your comment`,
          { postId: comment.postId, commentId: id, likedBy: userId }
        );

        this.notificationsGateway.emitPostCommentLiked(comment.userId, {
          postId: comment.postId,
          commentId: id,
          likedBy: { id: user.id, name: user.name, username: user.username, avatar: user.avatar },
        });
      }
    }

    return { message: 'Comment liked' };
  }

  async unlikeComment(userId: string, id: string) {
    const like = await this.prisma.postCommentLike.findUnique({
      where: { commentId_userId: { commentId: id, userId } },
    });
    if (!like) throw new NotFoundException('Like not found');

    await this.prisma.postCommentLike.delete({ where: { id: like.id } });

    const comment = await this.prisma.postComment.findUnique({ where: { id } });
    if (comment && comment.userId !== userId) {
       this.notificationsGateway.emitPostCommentUnliked(comment.userId, { postId: comment.postId, commentId: id, unlikedBy: userId });
    }

    return { message: 'Comment unliked' };
  }
}
