import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { PostsService } from './posts.service';
import { FeedService } from './feed/feed.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiBearerAuth, ApiTags, ApiQuery, ApiOperation } from '@nestjs/swagger';

@ApiTags('Posts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('posts')
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly feedService: FeedService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new post' })
  create(@CurrentUser('id') userId: string, @Body() createPostDto: CreatePostDto) {
    return this.postsService.createPost(userId, createPostDto);
  }

  @Get('feed')
  @ApiOperation({ summary: 'Get social feed' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getFeed(
    @CurrentUser('id') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.feedService.getFeed(userId, cursor, limit ? Number(limit) : 20);
  }

  @Get('user/:targetUserId')
  @ApiOperation({ summary: 'Get posts for a specific user' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getUserPosts(
    @CurrentUser('id') userId: string,
    @Param('targetUserId') targetUserId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.feedService.getUserPosts(userId, targetUserId, cursor, limit ? Number(limit) : 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single post by ID' })
  findOne(@Param('id') id: string) {
    return this.postsService.getPostById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a post' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.updatePost(userId, id, updatePostDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a post' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.postsService.deletePost(userId, id);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Like a post' })
  likePost(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.postsService.likePost(userId, id);
  }

  @Delete(':id/like')
  @ApiOperation({ summary: 'Unlike a post' })
  unlikePost(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.postsService.unlikePost(userId, id);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Save a post' })
  savePost(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.postsService.savePost(userId, id);
  }

  @Delete(':id/save')
  @ApiOperation({ summary: 'Unsave a post' })
  unsavePost(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.postsService.unsavePost(userId, id);
  }
}
