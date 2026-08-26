export type DomainErrorKind =
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'UNAUTHORIZED' | 'INTERNAL';

const KIND_TO_STATUS: Record<DomainErrorKind, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class DomainException extends Error {
  readonly code: string;
  readonly kind: DomainErrorKind;
  readonly status: number;

  constructor(kind: DomainErrorKind, code: string, message: string) {
    super(message);
    this.name = 'DomainException';
    this.kind = kind;
    this.code = code;
    this.status = KIND_TO_STATUS[kind];
  }
}
