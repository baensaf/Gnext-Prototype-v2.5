import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BRANCH_OWNED_KEY, BranchOwnedSpec } from '../decorators/branch-owned.decorator';

/**
 * A branch account may only act on its own branch's records.
 *
 * Registered globally, and inert on a route that carries no `@BranchOwned(...)` — like the
 * role guard, a route becomes restricted only when someone says so at the handler.
 *
 * Head office is skipped: an account with no branch of its own is the one account for which
 * "another branch" means nothing.
 */
@Injectable()
export class BranchOwnershipGuard implements CanActivate {
  /** Ids here are always uuid primary keys; anything else cannot name a record. */
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<BranchOwnedSpec>(BRANCH_OWNED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!spec) return true;

    const req = context.switchToHttp().getRequest();
    const userBranchId = req?.userBranchId;
    if (!userBranchId) return true;

    // A create names no record, and a class-level mark covers those routes too.
    const id = spec.body ? req.body?.[spec.body] : req.params?.[spec.param || 'id'];
    if (!id) return true;

    const owner = await this.branchOf(spec, req.tenantId, id);

    // No such record for this tenant. Answering "forbidden" would confirm that an id
    // belongs to somebody, which is the question the caller was not entitled to ask.
    if (owner === undefined) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Not Found',
        detail: 'No such record.',
      });
    }

    // A record with no branch belongs to the chain, which is head office's to change.
    if (owner !== userBranchId) {
      throw new ForbiddenException({
        code: 'OTHER_BRANCH',
        title: 'Belongs To Another Branch',
        detail: 'This record belongs to a branch other than your own.',
      });
    }

    return true;
  }

  /** The branch a record belongs to: `null` for the chain, `undefined` when there is no record. */
  private async branchOf(
    spec: BranchOwnedSpec,
    tenantId: string | undefined,
    id: string,
  ): Promise<string | null | undefined> {
    if (!BranchOwnershipGuard.UUID.test(id)) return undefined;

    const repo = this.dataSource.getRepository(spec.entity as any);
    const qb = repo
      .createQueryBuilder('record')
      // Ownership, not liveness: an archived record still belongs to the shop that has it,
      // and a route that revives one must be judged on the same rule as the rest.
      .withDeleted()
      .where('record.id = :id', { id });

    if (tenantId && repo.metadata.findColumnWithPropertyName('tenant_id')) {
      qb.andWhere('record.tenant_id = :tenantId', { tenantId });
    }

    if (spec.through) {
      qb.innerJoin(spec.through.entity, 'owner', `owner.id = record.${spec.through.foreignKey}`)
        .select('owner.branch_id', 'branch_id');
    } else {
      qb.select('record.branch_id', 'branch_id');
    }

    const row = await qb.getRawOne<{ branch_id: string | null }>();
    return row ? row.branch_id : undefined;
  }
}
