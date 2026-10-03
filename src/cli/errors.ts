import type { ErrorCode } from '../core/output';
import type { Issue } from '../core/schema';

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly issues?: Issue[];
  readonly status?: number;

  constructor(code: ErrorCode, message: string, issues?: Issue[], status?: number) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.issues = issues;
    this.status = status;
  }
}
