import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { SendFriendRequestDto } from './dto/send-friend-request.dto';
import { RespondRequestDto } from './dto/respond-request.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Friends')
@ApiBearerAuth()
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: 'Get friend list' })
  getFriends(@CurrentUser() user: { id: string }) {
    return this.friendsService.getFriends(user.id);
  }

  @Get('requests/pending')
  @ApiOperation({ summary: 'Get incoming pending friend requests' })
  getPendingRequests(@CurrentUser() user: { id: string }) {
    return this.friendsService.getPendingRequests(user.id);
  }

  @Get('requests/sent')
  @ApiOperation({ summary: 'Get sent pending friend requests' })
  getSentRequests(@CurrentUser() user: { id: string }) {
    return this.friendsService.getSentRequests(user.id);
  }

  @Post('request')
  @ApiOperation({ summary: 'Send a friend request' })
  sendRequest(
    @CurrentUser() user: { id: string },
    @Body() dto: SendFriendRequestDto,
  ) {
    return this.friendsService.sendRequest(user.id, dto.receiverId);
  }

  @Post('accept')
  @ApiOperation({ summary: 'Accept a friend request' })
  acceptRequest(
    @CurrentUser() user: { id: string },
    @Body() dto: RespondRequestDto,
  ) {
    return this.friendsService.acceptRequest(dto.requestId, user.id);
  }

  @Post('reject')
  @ApiOperation({ summary: 'Reject a friend request' })
  rejectRequest(
    @CurrentUser() user: { id: string },
    @Body() dto: RespondRequestDto,
  ) {
    return this.friendsService.rejectRequest(dto.requestId, user.id);
  }

  @Delete('cancel/:id')
  @ApiOperation({ summary: 'Cancel a sent friend request' })
  cancelRequest(
    @CurrentUser() user: { id: string },
    @Param('id') requestId: string,
  ) {
    return this.friendsService.cancelRequest(requestId, user.id);
  }

  @Delete(':friendshipId')
  @ApiOperation({ summary: 'Remove a friend' })
  removeFriend(
    @CurrentUser() user: { id: string },
    @Param('friendshipId') friendshipId: string,
  ) {
    return this.friendsService.removeFriend(friendshipId, user.id);
  }
  @Get('blocked')
  @ApiOperation({ summary: 'Get blocked users list' })
  getBlockedUsers(@CurrentUser() user: { id: string }) {
    return this.friendsService.getBlockedUsers(user.id);
  }

  @Post('block')
  @ApiOperation({ summary: 'Block a user' })
  blockUser(
    @CurrentUser() user: { id: string },
    @Body('userId') targetId: string,
  ) {
    return this.friendsService.blockUser(user.id, targetId);
  }

  @Delete('unblock/:userId')
  @ApiOperation({ summary: 'Unblock a user' })
  unblockUser(
    @CurrentUser() user: { id: string },
    @Param('userId') targetId: string,
  ) {
    return this.friendsService.unblockUser(user.id, targetId);
  }
}
