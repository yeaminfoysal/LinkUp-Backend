/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchUserDto } from './dto/search-user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  getMe(@CurrentUser() user: { id: string }) {
    return this.usersService.getProfile(user.id);
  }

  @Put('me')
  @ApiOperation({ summary: 'Update own profile' })
  updateMe(@CurrentUser() user: { id: string }, @Body() dto: UpdateUserDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search users by name or username' })
  search(@Query() dto: SearchUserDto, @CurrentUser() user: { id: string }) {
    return this.usersService.searchUsers(dto, user.id);
  }

  @Get('suggestions')
  @ApiOperation({ summary: 'Get user suggestions (People you may know)' })
  getSuggestions(
    @CurrentUser() user: { id: string },
    @Query('limit') limit?: string,
    @Query('global') global?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 4;
    const isGlobal = global === 'true';
    return this.usersService.getSuggestions(user.id, limitNum, isGlobal);
  }

  @Get('profile/:username')
  @ApiOperation({ summary: 'Get profile by username with block details' })
  async getProfileByUsername(
    @Param('username') username: string,
    @CurrentUser() currentUser: { id: string },
  ) {
    return this.usersService.getProfileByUsername(username, currentUser.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user profile by ID' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUser(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }
}
