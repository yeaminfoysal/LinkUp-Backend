import { forwardRef, Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AiDiscoveryModule } from '../ai-discovery/ai-discovery.module';

@Module({
  imports: [forwardRef(() => AiDiscoveryModule)],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
