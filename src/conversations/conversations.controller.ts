import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { CreateDirectDto } from './dto/create-direct.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post('direct')
  @ApiOperation({ summary: 'Create or get a direct conversation' })
  createDirect(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateDirectDto,
  ) {
    return this.conversationsService.createDirectConversation(user.id, dto);
  }

  @Post('group')
  @ApiOperation({ summary: 'Create a group conversation' })
  createGroup(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateGroupDto,
  ) {
    return this.conversationsService.createGroupConversation(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List conversations (offset paginated)' })
  getConversations(
    @CurrentUser() user: { id: string },
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.conversationsService.getConversations(user.id, page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single conversation by ID' })
  getConversation(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.conversationsService.getConversationById(id, user.id);
  }
}
