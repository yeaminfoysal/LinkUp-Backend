import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PostVisibility } from '../../common/enums/post-visibility.enum';

export class CreatePostDto {
  @ApiPropertyOptional({ description: 'Text content of the post' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ description: 'Array of media URLs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @ApiPropertyOptional({ enum: PostVisibility, default: PostVisibility.PUBLIC })
  @IsOptional()
  @IsEnum(PostVisibility)
  visibility?: PostVisibility;
}
