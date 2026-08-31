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

// The MIME type a browser or an HTTP client sends for a .xlsx file. Spec
// §4.2 requires the type check alongside the byte limit — an endpoint that
// accepts files is attack surface, and "any file under 5MB" is not a type
// check. This is the first line of defence; parseWorkbook's own try/catch
// is the second, for a file whose extension and declared type lie.
const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
      fileFilter: (_req, file, callback) => {
        if (file.mimetype !== XLSX_MIME_TYPE) {
          callback(
            new BadRequestException(
              'El archivo debe ser una hoja de cálculo de Excel (.xlsx).',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
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
