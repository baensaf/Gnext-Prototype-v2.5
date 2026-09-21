import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { NoteTemplate } from '../src/entities/NoteTemplate.entity';
import { NoteTemplateService } from '../src/modules/catalog/note-template.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

/**
 * The phrases a cashier taps instead of typing a note.
 *
 * The rules worth holding: a phrase prints exactly as stored, the same phrase cannot be
 * offered twice, and one that has been on real tickets is retired rather than deleted.
 */
describe('NoteTemplateService', () => {
  let service: NoteTemplateService;
  let repo: any;
  let auditWriter: any;
  let queryBuilder: any;

  beforeEach(async () => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    };
    repo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto: any) => ({ id: 'n-1', ...dto })),
      save: jest.fn().mockImplementation((row: any) => Promise.resolve(row)),
    };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoteTemplateService,
        { provide: getRepositoryToken(NoteTemplate), useValue: repo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get(NoteTemplateService);
  });

  it('trims the phrase but keeps it otherwise exactly as typed', async () => {
    const saved = await service.create('t-1', { scope: 'ORDER', text: '  Call on arrival  ' }, 'u-1');

    expect(saved.text).toBe('Call on arrival');
    expect(saved.scope).toBe('ORDER');
    expect(auditWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'NOTE_TEMPLATE_CREATED' }),
    );
  });

  it('defaults to the item scope and uppercases what it is given', async () => {
    const saved = await service.create('t-1', { text: 'No onion' }, 'u-1');
    expect(saved.scope).toBe('ITEM');

    const explicit = await service.create('t-1', { scope: 'order', text: 'Ring the bell' }, 'u-1');
    expect(explicit.scope).toBe('ORDER');
  });

  it('refuses an empty phrase', async () => {
    await expect(service.create('t-1', { text: '   ' }, 'u-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses a scope that is neither an item nor an order', async () => {
    await expect(service.create('t-1', { scope: 'KITCHEN', text: 'Rush' }, 'u-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses the same phrase twice in the same scope', async () => {
    repo.findOne.mockResolvedValue({ id: 'n-existing', text: 'No onion', scope: 'ITEM' });

    await expect(service.create('t-1', { text: 'No onion' }, 'u-1')).rejects.toThrow(ConflictException);
  });

  it('retires a phrase rather than deleting it, since it is on tickets already printed', async () => {
    repo.findOne.mockResolvedValue({ id: 'n-5', tenant_id: 't-1', text: 'Extra spicy', is_active: true });

    const saved = await service.archive('t-1', 'n-5', 'u-1');

    expect(saved.is_active).toBe(false);
    expect(auditWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'NOTE_TEMPLATE_ARCHIVED' }),
    );
  });

  it('will not touch another tenant\'s phrase', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.update('t-1', 'n-other', { text: 'Mine now' }, 'u-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('offers the register only what is in service, in display order', async () => {
    await service.list('t-1', { scope: 'ORDER' });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith('n.scope = :scope', { scope: 'ORDER' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('n.is_active = true');
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('n.sort_order', 'ASC');
  });

  it('shows retired phrases to the settings screen, which is where they come back', async () => {
    await service.list('t-1', { includeInactive: true });

    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith('n.is_active = true');
  });
});
