import {
  IsString,
  IsOptional,
  IsUUID,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ description: 'Text content of the comment' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({ description: 'Parent comment ID for replies' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiProperty({ description: 'Post ID' })
  @IsNotEmpty()
  @IsUUID()
  postId: string;
}
