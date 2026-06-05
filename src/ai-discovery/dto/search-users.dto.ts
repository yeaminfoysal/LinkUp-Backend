import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SearchUsersDto {
  @ApiProperty({
    example: 'backend developer interested in AI from Dhaka',
    description: 'Natural language query to find matching users',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  query: string;
}
