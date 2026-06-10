import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../common/enums/notification-type.enum';

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createPost(userId: string, createPostDto: CreatePostDto) {
    if (
      !createPostDto.content &&
      (!createPostDto.mediaUrls || createPostDto.mediaUrls.length === 0)
    ) {
      throw new BadRequestException('Post must contain content or media');
    }

    return this.prisma.post.create({
      data: {
        userId,
        content: createPostDto.content,
        mediaUrls: createPostDto.mediaUrls || [],
        visibility: createPostDto.visibility,
      },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true },
        },
      },
    });
  }

  async getPostById(postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, isDeleted: false },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true },
        },
        _count: {
          select: { likes: true, comments: { where: { isDeleted: false } } },
        },
      },
    });

    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async updatePost(
    userId: string,
    postId: string,
    updatePostDto: UpdatePostDto,
  ) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.isDeleted) throw new NotFoundException('Post not found');
    if (post.userId !== userId)
      throw new ForbiddenException('You can only edit your own post');

    return this.prisma.post.update({
      where: { id: postId },
      data: updatePostDto,
    });
  }

  async deletePost(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.isDeleted) throw new NotFoundException('Post not found');
    if (post.userId !== userId)
      throw new ForbiddenException('You can only delete your own post');

    return this.prisma.post.update({
      where: { id: postId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async likePost(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, isDeleted: false },
    });
    if (!post) throw new NotFoundException('Post not found');

    // Avoid duplicate likes
    const existingLike = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existingLike) return { message: 'Already liked' };

    await this.prisma.postLike.create({ data: { postId, userId } });

    // Notify post owner
    if (post.userId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await this.notificationsService.createNotification(
          post.userId,
          NotificationType.POST_LIKED,
          user.name,
          `${user.name} liked your post`,
          { postId, likedBy: userId },
        );

        this.notificationsGateway.emitPostLiked(post.userId, {
          postId,
          likedBy: {
            id: user.id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
          },
        });
      }
    }

    return { message: 'Post liked' };
  }

  async unlikePost(userId: string, postId: string) {
    const like = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (!like) throw new NotFoundException('Like not found');

    await this.prisma.postLike.delete({ where: { id: like.id } });

    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (post && post.userId !== userId) {
      this.notificationsGateway.emitPostUnliked(post.userId, {
        postId,
        unlikedBy: userId,
      });
    }

    return { message: 'Post unliked' };
  }

  async savePost(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, isDeleted: false },
    });
    if (!post) throw new NotFoundException('Post not found');

    const existing = await this.prisma.savedPost.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) return { message: 'Already saved' };

    await this.prisma.savedPost.create({ data: { postId, userId } });
    return { message: 'Post saved' };
  }

  async unsavePost(userId: string, postId: string) {
    const saved = await this.prisma.savedPost.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (!saved) throw new NotFoundException('Saved post not found');

    await this.prisma.savedPost.delete({ where: { id: saved.id } });
    return { message: 'Post unsaved' };
  }

  async getPostLikes(postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, isDeleted: false },
    });
    if (!post) throw new NotFoundException('Post not found');

    const likes = await this.prisma.postLike.findMany({
      where: { postId },
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
      orderBy: { createdAt: 'desc' },
    });

    return likes.map((l) => l.user);
  }
}
