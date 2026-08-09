import { DataSource, EntityManager } from 'typeorm';

export class TransactionUtil {
  /**
   * Executes a callback within a database transaction manager.
   * Rollback is performed automatically if an exception is thrown.
   */
  static async runInTransaction<T>(
    dataSource: DataSource,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Performs pessimistic write locking on a single entity record.
   */
  static async lockForUpdate<T>(
    manager: EntityManager,
    entityClass: new () => T,
    id: string,
  ): Promise<T | null> {
    return await manager.getRepository(entityClass).findOne({
      where: { id } as any,
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Performs pessimistic write locking on multiple entity records in deterministic ID order
   * to avoid PostgreSQL deadlocks.
   */
  static async lockInOrder<T>(
    manager: EntityManager,
    entityClass: new () => T,
    ids: string[],
  ): Promise<T[]> {
    const sortedIds = Array.from(new Set(ids)).sort();
    const results: T[] = [];
    for (const id of sortedIds) {
      const item = await TransactionUtil.lockForUpdate(manager, entityClass, id);
      if (item) {
        results.push(item);
      }
    }
    return results;
  }
}
