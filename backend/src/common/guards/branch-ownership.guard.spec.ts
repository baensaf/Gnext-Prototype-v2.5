import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BRANCH_OWNED_KEY } from '../decorators/branch-owned.decorator';
import { BranchOwnershipGuard } from './branch-ownership.guard';

const contextFor = (req: any) =>
  ({
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => req }),
  }) as any;

const reflectorFor = (meta: Record<string, any>) =>
  ({ getAllAndOverride: (key: string) => meta[key] }) as any;

/**
 * A data source that answers one question: which branch owns this row. `rows` maps an id
 * to a branch, `null` meaning the chain owns it and a missing key meaning no such record.
 */
const dataSourceFor = (rows: Record<string, string | null>, spy?: { joined?: string }) => {
  const qb: any = {
    withDeleted: () => qb,
    where: (_c: string, params: any) => {
      qb.id = params.id;
      return qb;
    },
    andWhere: () => qb,
    select: () => qb,
    innerJoin: (_entity: any, alias: string) => {
      if (spy) spy.joined = alias;
      return qb;
    },
    getRawOne: async () =>
      qb.id in rows ? { branch_id: rows[qb.id] } : undefined,
  };
  return {
    getRepository: () => ({
      metadata: { findColumnWithPropertyName: () => true },
      createQueryBuilder: () => qb,
    }),
  } as any;
};

class Terminal {}
class DiningTable {}
class DiningArea {}

const DOWNTOWN = '11111111-1111-4111-8111-111111111111';
const CENTRAL = '22222222-2222-4222-8222-222222222222';

const ownTerminal = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherTerminal = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const chainRecord = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const rows = {
  [ownTerminal]: DOWNTOWN,
  [otherTerminal]: CENTRAL,
  [chainRecord]: null,
};

const marked = { [BRANCH_OWNED_KEY]: { entity: Terminal } };

const request = (branchId: string | null, id?: string) => ({
  tenantId: 'tenant-1',
  userBranchId: branchId,
  params: id ? { id } : {},
});

describe('BranchOwnershipGuard', () => {
  const guard = (meta: Record<string, any>, data = rows, spy?: any) =>
    new BranchOwnershipGuard(reflectorFor(meta), dataSourceFor(data, spy));

  // The whole API is behind this guard, so the case that matters most is a route that
  // never asked for it.
  it('leaves an unmarked route alone', async () => {
    await expect(guard({}).canActivate(contextFor(request(DOWNTOWN, otherTerminal)))).resolves.toBe(
      true,
    );
  });

  it('admits a branch acting on its own record', async () => {
    await expect(guard(marked).canActivate(contextFor(request(DOWNTOWN, ownTerminal)))).resolves.toBe(
      true,
    );
  });

  // The hole this guard closes: ids are not secret, and every service behind these routes
  // looked a record up by tenant and id alone.
  it('refuses a branch naming another branch’s record', async () => {
    await expect(
      guard(marked).canActivate(contextFor(request(DOWNTOWN, otherTerminal))),
    ).rejects.toThrow(ForbiddenException);
  });

  // Head office has no branch of its own; "another branch" means nothing to it.
  it('admits head office anywhere', async () => {
    await expect(guard(marked).canActivate(contextFor(request(null, otherTerminal)))).resolves.toBe(
      true,
    );
  });

  it('refuses a branch touching a record the chain owns', async () => {
    await expect(
      guard(marked).canActivate(contextFor(request(DOWNTOWN, chainRecord))),
    ).rejects.toThrow(ForbiddenException);
  });

  // Answering "forbidden" would confirm that an id belongs to somebody, which is the
  // question the caller was not entitled to ask.
  it('answers not-found for an id belonging to no record', async () => {
    await expect(
      guard(marked).canActivate(contextFor(request(DOWNTOWN, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'))),
    ).rejects.toThrow(NotFoundException);
  });

  it('answers not-found for an id that is not an id', async () => {
    await expect(
      guard(marked).canActivate(contextFor(request(DOWNTOWN, 'not-a-uuid'))),
    ).rejects.toThrow(NotFoundException);
  });

  // A class-level mark covers the creates too, and those name no record.
  it('passes a route that names no record', async () => {
    await expect(guard(marked).canActivate(contextFor(request(DOWNTOWN)))).resolves.toBe(true);
  });

  it('reads a named parameter other than id', async () => {
    const req = { tenantId: 't', userBranchId: DOWNTOWN, params: { terminalId: otherTerminal } };
    const withParam = { [BRANCH_OWNED_KEY]: { entity: Terminal, param: 'terminalId' } };
    await expect(guard(withParam).canActivate(contextFor(req))).rejects.toThrow(ForbiddenException);
  });

  // A table has no branch column: it belongs to a floor, and the floor belongs to a shop.
  it('follows a record that reaches its branch through a parent', async () => {
    const spy: { joined?: string } = {};
    const through = {
      [BRANCH_OWNED_KEY]: {
        entity: DiningTable,
        through: { entity: DiningArea, foreignKey: 'dining_area_id' },
      },
    };
    await expect(
      guard(through, rows, spy).canActivate(contextFor(request(DOWNTOWN, otherTerminal))),
    ).rejects.toThrow(ForbiddenException);
    expect(spy.joined).toBe('owner');
  });

  // A create names its parent in the body: a table under a floor. The interceptor rewrites a
  // body's branch_id, not the parent's id, so the parent has to be checked here.
  it('refuses a create under a parent that another branch owns', async () => {
    const underParent = { [BRANCH_OWNED_KEY]: { entity: DiningArea, body: 'dining_area_id' } };
    const create = (areaId: string) => ({ ...request(DOWNTOWN), body: { dining_area_id: areaId } });
    await expect(guard(underParent).canActivate(contextFor(create(otherTerminal)))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard(underParent).canActivate(contextFor(create(ownTerminal)))).resolves.toBe(true);
  });
});
