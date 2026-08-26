import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Preparar informe Q3', maxLength: 200 })
  @IsString()
  @IsNotEmpty({ message: 'title is required' })
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @ApiPropertyOptional({ example: 'Incluir métricas de churn y NPS' })
  @IsOptional()
  @IsString()
  description?: string;
}
