import { ConflictException } from '@nestjs/common';

export class VersionConflictException extends ConflictException {
  constructor(currentVersion?: number, expectedVersion?: number) {
    super({
      type: 'https://gnext.local/problems/version-conflict',
      code: 'VERSION_CONFLICT',
      title: 'Version Conflict',
      detail: expectedVersion !== undefined && currentVersion !== undefined
        ? `Resource version conflict. Expected version ${expectedVersion}, but current version is ${currentVersion}.`
        : 'Resource has been modified by another transaction. Please reload and retry.',
    });
  }
}
