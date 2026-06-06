/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AiDiscoveryService } from './ai-discovery.service';
import { SearchUsersDto } from './dto/search-users.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('AI Discovery')
@ApiBearerAuth()
@Controller('ai')
export class AiDiscoveryController {
  constructor(private readonly aiDiscoveryService: AiDiscoveryService) {}

  /**
   * POST /ai/search-users
   * Natural language user search — max 10 requests per minute
   */
  @Post('search-users')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Search users with natural language (AI-powered)',
    description:
      'Convert a natural language query into an embedding vector and find users via cosine similarity. Returns ranked results with match scores and AI-generated match reasons.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ranked list of matching users with match scores and reasons',
  })
  @ApiResponse({ status: 503, description: 'AI service temporarily unavailable' })
  async searchUsers(
    @Body() dto: SearchUsersDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.aiDiscoveryService.searchUsers(dto.query, user.id);
  }

  /**
   * PATCH /ai/update-embedding/:userId
   * Manually trigger embedding regeneration — max 5 per hour
   */
  @Patch('update-embedding/:userId')
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiOperation({
    summary: 'Manually trigger profile embedding regeneration',
    description:
      'Force regenerate the AI embedding for a user profile. Useful for admin tools or background jobs.',
  })
  @ApiResponse({ status: 200, description: 'Embedding updated successfully' })
  async updateEmbedding(@Param('userId') userId: string) {
    await this.aiDiscoveryService.updateUserEmbedding(userId);
    return { message: 'Embedding updated successfully', userId };
  }
}