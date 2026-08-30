import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConsumptionsService } from '../consumptions.service';
import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { assertIncludeInactiveAllowed } from '../../common/authorization/assert-include-inactive-allowed';
import { exportFilename } from './export-filename';
import { writeConsumptionsWorkbook } from './excel-writer';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('consumptions')
export class ConsumptionsExportController {
  constructor(private readonly consumptions: ConsumptionsService) {}

  @Get('export.xlsx')
  async exportXlsx(
    @Query() query: ListConsumptionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const isAdmin = actor.role === 'ADMIN';
    assertIncludeInactiveAllowed(query.includeVoided, actor.role);

    // Everything that can fail happens before a byte is written. Taking over
    // the response with @Res() opts this handler out of Nest's exception
    // filter, so a throw after the headers are sent cannot become a status
    // code — it reaches the user as a truncated file that opens cleanly.
    const rows = await this.consumptions.selectForExport(query, isAdmin);
    const filename = exportFilename('xlsx', query, new Date());

    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );

    await writeConsumptionsWorkbook(
      rows,
      isAdmin && query.includeVoided === true,
      response,
    );
  }
}
