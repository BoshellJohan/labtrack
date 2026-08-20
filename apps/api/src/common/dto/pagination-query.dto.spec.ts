import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

async function build(raw: Record<string, unknown>) {
  const dto = plainToInstance(PaginationQueryDto, raw, {
    enableImplicitConversion: true,
  });
  return { dto, errors: await validate(dto) };
}

describe('PaginationQueryDto', () => {
  it('defaults to page 1 with 20 items', async () => {
    const { dto, errors } = await build({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
    expect(dto.skip).toBe(0);
  });

  it('computes skip from page and pageSize', async () => {
    const { dto } = await build({ page: 3, pageSize: 10 });
    expect(dto.skip).toBe(20);
  });

  it('rejects a pageSize above 100', async () => {
    const { errors } = await build({ pageSize: 500 });
    expect(errors).not.toHaveLength(0);
  });

  it('rejects a page below 1', async () => {
    const { errors } = await build({ page: 0 });
    expect(errors).not.toHaveLength(0);
  });
});
