import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportPreview } from '@labtrack/shared';
import { ImportService } from './import.service';
import { parseWorkbook } from './parse-workbook';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('reagents/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  // ADMIN only, on both routes: creating reagents and batches already is, and
  // an import must not be a side door into what manual creation restricts.
  @Post('preview')
  @Roles('ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      // A byte ceiling is not optional on an endpoint that accepts files.
      // The row limit bounds what we will process; this bounds what we will
      // even read into memory.
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async preview(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ImportPreview> {
    if (!file) {
      throw new BadRequestException('A spreadsheet file is required');
    }
    const rows = await parseWorkbook(file.buffer);
    return this.imports.preview(rows);
  }

  @Post('confirm')
  @Roles('ADMIN')
  async confirm(
    @Body() dto: ConfirmImportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ reagentsCreated: number; batchesCreated: number }> {
    return this.imports.confirm(dto.rows, actor.id);
  }
}
