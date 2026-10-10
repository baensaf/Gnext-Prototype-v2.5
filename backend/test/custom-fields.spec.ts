import { BadRequestException } from '@nestjs/common';
import { CustomFieldsService } from '../src/modules/customer/custom-fields.service';

/** Enough of a repository for the service: equality where clauses and saves that keep rows. */
const fakeRepo = () => {
  const rows: any[] = [];
  let seq = 0;
  const matches = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: [string, any]) => (v && typeof v === 'object' && '_value' in v ? v._value.includes(row[k]) : row[k] === v));
  return {
    rows,
    find: jest.fn(async (opts: any = {}) => rows.filter((r) => matches(r, opts.where))),
    findOne: jest.fn(async (opts: any = {}) => rows.find((r) => matches(r, opts.where)) || null),
    count: jest.fn(async (opts: any = {}) => rows.filter((r) => matches(r, opts.where)).length),
    create: jest.fn((e: any) => ({ ...e })),
    save: jest.fn(async (e: any) => {
      if (!e.id) {
        e.id = `row-${++seq}`;
        e.created_at = new Date();
        rows.push(e);
      }
      return e;
    }),
    delete: jest.fn(async ({ id }: any) => {
      rows.splice(rows.findIndex((r) => r.id === id), 1);
    }),
  };
};

describe('customer fields', () => {
  let fields: ReturnType<typeof fakeRepo>;
  let values: ReturnType<typeof fakeRepo>;
  let service: CustomFieldsService;

  beforeEach(() => {
    fields = fakeRepo();
    values = fakeRepo();
    service = new CustomFieldsService(fields as any, values as any, { write: jest.fn() } as any);
  });

  it('lets head office add gender as a choice, and refuses a choice with fewer than two answers', async () => {
    const gender = await service.create('t-1', { name: ' جنسیت ', data_type: 'choice', options: ['مرد', 'زن', 'زن'] });

    expect(gender).toMatchObject({ name: 'جنسیت', data_type: 'CHOICE', options: ['مرد', 'زن'], is_active: true });
    await expect(service.create('t-1', { name: 'Size', data_type: 'CHOICE', options: ['M'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create('t-1', { name: 'جنسیت', data_type: 'TEXT' })).rejects.toThrow('already exists');
  });

  it('checks each answer against its field, and a new customer against every required field', async () => {
    const gender = await service.create('t-1', { name: 'Gender', data_type: 'CHOICE', options: ['Male', 'Female'], is_required: true });
    const wedding = await service.create('t-1', { name: 'Wedding', data_type: 'DATE' });

    await expect(service.validate('t-1', { [gender.id]: 'Other' }, true)).rejects.toThrow('must be one of');
    await expect(service.validate('t-1', { [wedding.id]: '15/06/2015' }, false)).rejects.toThrow('must be a date');
    await expect(service.validate('t-1', { [wedding.id]: '2015-06-15' }, true)).rejects.toThrow('Gender required');
    await expect(service.validate('t-1', { 'not-a-field': 'x' }, false)).rejects.toThrow('Unknown customer field');
    expect(await service.validate('t-1', { [gender.id]: ' Female ', [wedding.id]: '' }, true)).toEqual({ [gender.id]: 'Female', [wedding.id]: null });
  });

  it('keeps one answer per customer and field, and an empty answer clears it', async () => {
    const note = await service.create('t-1', { name: 'Favourite', data_type: 'TEXT' });

    expect(await service.save('t-1', 'cust-1', { [note.id]: 'Zinger' })).toEqual({ [note.id]: 'Zinger' });
    expect(await service.save('t-1', 'cust-1', { [note.id]: 'Mix' })).toEqual({ [note.id]: 'Mix' });
    expect(values.rows).toHaveLength(1);
    expect(await service.save('t-1', 'cust-1', { [note.id]: null })).toEqual({});
  });

  it('archives a field without losing the answers, and stops its type changing once answered', async () => {
    const age = await service.create('t-1', { name: 'Age', data_type: 'NUMBER' });
    await service.save('t-1', 'cust-1', { [age.id]: '30' });

    await expect(service.update('t-1', age.id, { data_type: 'TEXT' })).rejects.toThrow('type cannot change');
    await service.archive('t-1', age.id);

    expect(await service.list('t-1')).toEqual([]);
    expect(await service.valuesFor('t-1', 'cust-1')).toEqual({ [age.id]: '30' });
  });
});
