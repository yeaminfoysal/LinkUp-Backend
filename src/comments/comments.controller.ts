import { Controller, Get, Post, Body, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiBearerAuth, ApiTags, ApiQuery, ApiOperation } from '@nestjs/swagger';

@ApiTags('Comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({ summary: 'Add a comment to a post' })
  create(
    @CurrentUser('id') userId: string,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.commentsService.createComment(userId, createCommentDto.postId, createCommentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get comments for a post' })
  @ApiQuery({ name: 'postId', required: true })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getComments(
    @Query('postId') postId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.commentsService.getCommentsByPost(postId, cursor, limit ? Number(limit) : 20);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a comment' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.commentsService.deleteComment(userId, id);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Like a comment' })
  likeComment(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.commentsService.likeComment(userId, id);
  }

  @Delete(':id/like')
  @ApiOperation({ summary: 'Unlike a comment' })
  unlikeComment(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.commentsService.unlikeComment(userId, id);
  }
}
