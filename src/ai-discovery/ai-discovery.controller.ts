 
 
import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
import { HttpRolesGuard } from '../common/guards/http-roles.guard';
import { HttpRoles } from '../common/decorators/http-roles.decorator';

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
      'Hybrid search: converts the query into an embedding vector for semantic matching (pgvector cosine similarity) and also matches exact names/usernames. Returns ranked results with match scores, AI-generated match reasons, and friendship status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ranked list of matching users with match scores and reasons',
  })
  @ApiResponse({
    status: 503,
    description: 'AI service temporarily unavailable',
  })
  async searchUsers(
    @Body() dto: SearchUsersDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.aiDiscoveryService.searchUsers(dto.query, user.id);
  }

  /**
   * PATCH /ai/update-embedding/:userId
   * Manually trigger embedding regeneration — admin only, max 5 per hour
   */
  @Patch('update-embedding/:userId')
  @UseGuards(HttpRolesGuard)
  @HttpRoles('SUPER_ADMIN')
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiOperation({
    summary: 'Manually trigger profile embedding regeneration (admin)',
    description:
      'Force regenerate the AI embedding for a user profile. Useful for admin tools or background jobs.',
  })
  @ApiResponse({ status: 200, description: 'Embedding updated successfully' })
  async updateEmbedding(@Param('userId') userId: string) {
    const updated = await this.aiDiscoveryService.updateUserEmbedding(userId);
    return {
      message: updated
        ? 'Embedding updated successfully'
        : 'Embedding skipped (user not found, empty profile, or AI unavailable)',
      updated,
      userId,
    };
  }

  /**
   * POST /ai/reindex-embeddings
   * Regenerate ALL user embeddings — admin only, max 2 per hour.
   * Required once after changing the embedding model or taskType,
   * since old and new vectors are not comparable.
   */
  @Post('reindex-embeddings')
  @UseGuards(HttpRolesGuard)
  @HttpRoles('SUPER_ADMIN')
  @Throttle({ default: { limit: 2, ttl: 3600000 } })
  @ApiOperation({
    summary: 'Regenerate embeddings for all users (admin)',
    description:
      'Sequentially regenerates every user profile embedding. Run once after an embedding model/taskType change. May take a while for large user bases.',
  })
  @ApiResponse({
    status: 201,
    description: 'Reindex summary: { total, updated, skipped, failed }',
  })
  async reindexEmbeddings() {
    return this.aiDiscoveryService.regenerateAllEmbeddings();
  }
}
