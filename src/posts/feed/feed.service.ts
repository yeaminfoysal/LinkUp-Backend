import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PostVisibility } from '../../common/enums/post-visibility.enum';

@Injectable()
export class FeedService {
  constructor(private prisma: PrismaService) {}

  async getFeed(userId: string, filter?: string, cursor?: string, limit = 20) {
    // 1. Get user's friends
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      select: { user1Id: true, user2Id: true },
    });
    
    const friendIds = friendships.map((f) => (f.user1Id === userId ? f.user2Id : f.user1Id));

    // 2. Get blocked users
    const blockedRecords = await this.prisma.blockedUser.findMany({
      where: {
        OR: [{ blockedById: userId }, { blockedUserId: userId }],
      },
      select: { blockedById: true, blockedUserId: true },
    });
    
    const blockedIds = blockedRecords.map((b) => (b.blockedById === userId ? b.blockedUserId : b.blockedById));

    // 3. Build where clause and orderBy based on filter
    let whereClause: any = { isDeleted: false, userId: { notIn: blockedIds } };
    let orderBy: any = { createdAt: 'desc' };

    if (filter === 'friends') {
      // User's own posts + Friends' posts (PUBLIC or FRIENDS)
      whereClause.userId = { in: [userId, ...friendIds], notIn: blockedIds };
      whereClause.OR = [
        { visibility: PostVisibility.PUBLIC },
        { visibility: PostVisibility.FRIENDS },
      ];
    } else if (filter === 'trending') {
      // Trending: Same visibility as For You, but ordered by likes
      whereClause.OR = [
        { userId }, // Own posts
        { visibility: PostVisibility.PUBLIC }, // Public posts
        { visibility: PostVisibility.FRIENDS, userId: { in: friendIds } },
      ];
      orderBy = [
        { likes: { _count: 'desc' } },
        { createdAt: 'desc' }
      ];
    } else {
      // Default: 'for-you'
      whereClause.OR = [
        { userId }, // Own posts
        { visibility: PostVisibility.PUBLIC }, // Public posts
        { visibility: PostVisibility.FRIENDS, userId: { in: friendIds } },
      ];
    }

    // 4. Fetch posts
    const posts = await this.prisma.post.findMany({
      where: whereClause,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy,
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true } },
        _count: { select: { likes: true, comments: { where: { isDeleted: false } } } },
        likes: {
          where: { userId },
          select: { userId: true },
        },
        saved: {
          where: { userId },
          select: { userId: true },
        },
      },
    });

    const hasNextPage = posts.length > limit;
    const rawItems = hasNextPage ? posts.slice(0, -1) : posts;
    const nextCursor = hasNextPage ? rawItems[rawItems.length - 1].id : null;

    const items = rawItems.map((p) => {
      const { likes, saved, ...post } = p;
      return {
        ...post,
        hasLiked: likes.length > 0,
        hasSaved: saved.length > 0,
      };
    });

    return {
      items,
      nextCursor,
      hasNextPage,
    };
  }

  async getUserPosts(viewerId: string, targetUserId: string, cursor?: string, limit = 20) {
    // Check block status
    const isBlocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockedById: viewerId, blockedUserId: targetUserId },
          { blockedById: targetUserId, blockedUserId: viewerId },
        ],
      },
    });

    if (isBlocked) {
      return { items: [], nextCursor: null, hasNextPage: false };
    }

    // Check friendship
    const isFriend = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: viewerId, user2Id: targetUserId },
          { user1Id: targetUserId, user2Id: viewerId },
        ],
      },
    });

    const whereClause: any = {
      isDeleted: false,
      userId: targetUserId,
    };

    if (viewerId !== targetUserId) {
      if (isFriend) {
        whereClause.visibility = { in: [PostVisibility.PUBLIC, PostVisibility.FRIENDS] };
      } else {
        whereClause.visibility = PostVisibility.PUBLIC;
      }
    }

    const posts = await this.prisma.post.findMany({
      where: whereClause,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true } },
        _count: { select: { likes: true, comments: { where: { isDeleted: false } } } },
        likes: {
          where: { userId: viewerId },
          select: { userId: true },
        },
        saved: {
          where: { userId: viewerId },
          select: { userId: true },
        },
      },
    });

    const hasNextPage = posts.length > limit;
    const rawItems = hasNextPage ? posts.slice(0, -1) : posts;
    const nextCursor = hasNextPage ? rawItems[rawItems.length - 1].id : null;

    const items = rawItems.map((p) => {
      const { likes, saved, ...post } = p;
      return {
        ...post,
        hasLiked: likes.length > 0,
        hasSaved: saved.length > 0,
      };
    });

    return {
      items,
      nextCursor,
      hasNextPage,
    };
  }

  async getSavedPosts(userId: string, cursor?: string, limit = 20) {
    const savedPosts = await this.prisma.savedPost.findMany({
      where: { userId },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          include: {
            user: { select: { id: true, name: true, username: true, avatar: true } },
            _count: { select: { likes: true, comments: { where: { isDeleted: false } } } },
            likes: {
              where: { userId },
              select: { userId: true },
            },
            saved: {
              where: { userId },
              select: { userId: true },
            },
          },
        },
      },
    });

    const hasNextPage = savedPosts.length > limit;
    const rawItems = hasNextPage ? savedPosts.slice(0, -1) : savedPosts;
    const nextCursor = hasNextPage ? rawItems[rawItems.length - 1].id : null;

    const items = rawItems.map((sp) => {
      const p = sp.post;
      const { likes, saved, ...post } = p;
      return {
        ...post,
        hasLiked: likes.length > 0,
        hasSaved: saved.length > 0,
      };
    });

    return {
      items,
      nextCursor,
      hasNextPage,
    };
  }
}
