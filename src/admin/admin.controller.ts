import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { HttpRolesGuard } from '../common/guards/http-roles.guard';
import { HttpRoles } from '../common/decorators/http-roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, HttpRolesGuard)
@HttpRoles('SUPER_ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  async getUsers(
    @Query('sortBy') sortBy?: 'lastSeen' | 'createdAt',
    @Query('order') order?: 'asc' | 'desc',
  ) {
    return this.adminService.getAllUsers(sortBy, order);
  }

  @Get('users/:id/friends')
  async getUserFriends(@Param('id') id: string) {
    return this.adminService.getUserFriends(id);
  }

  @Get('users/:id/pending-requests')
  async getUserPendingRequests(@Param('id') id: string) {
    return this.adminService.getUserPendingRequests(id);
  }

  @Get('users/:id/conversations')
  async getUserConversations(@Param('id') id: string) {
    return this.adminService.getUserConversations(id);
  }

  @Get('conversations/:id/messages')
  async getConversationMessages(@Param('id') id: string) {
    return this.adminService.getConversationMessages(id);
  }
}
