import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGroupDto {
  @ApiProperty({ example: 'My Group' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: ['user-1-uuid', 'user-2-uuid'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  memberIds: string[];

  @ApiPropertyOptional({ example: 'https://cloudinary.com/...' })
  @IsOptional()
  @IsString()
  avatar?: string;
}
