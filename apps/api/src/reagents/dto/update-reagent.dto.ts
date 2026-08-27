import { PartialType } from '@nestjs/mapped-types';
import { CreateReagentDto } from './create-reagent.dto';

export class UpdateReagentDto extends PartialType(CreateReagentDto) {}
