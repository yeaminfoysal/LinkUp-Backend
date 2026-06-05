import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiDiscoveryController } from './ai-discovery.controller';
import { AiDiscoveryService } from './ai-discovery.service';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiDiscoveryController],
  providers: [AiDiscoveryService, EmbeddingService],
  exports: [AiDiscoveryService, EmbeddingService],
})
export class AiDiscoveryModule {}
