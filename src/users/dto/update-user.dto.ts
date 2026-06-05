import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ example: 'I love coding' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/...' })
  @IsOptional()
  @IsString()
  avatar?: string;

  // ── Extended profile fields for AI Discovery ──────────────────────────────

  @ApiPropertyOptional({ example: 'Dhaka, Bangladesh' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ example: 'BUET' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  university?: string;

  @ApiPropertyOptional({ example: 'Computer Science & Engineering' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  department?: string;

  @ApiPropertyOptional({ example: 'NestJS, TypeScript, PostgreSQL, Docker' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  skills?: string;

  @ApiPropertyOptional({ example: 'AI, System Design, Open Source, Football' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  interests?: string;

  @ApiPropertyOptional({ example: 'Backend Developer' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  profession?: string;

  @ApiPropertyOptional({ example: 'TechCorp Ltd.' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  work_place?: string;
}
