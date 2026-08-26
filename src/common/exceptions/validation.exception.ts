import { DomainException } from './domain.exception';

export class ValidationException extends DomainException {
  constructor(code: string, message: string) {
    super('VALIDATION_ERROR', code, message);
    this.name = 'ValidationException';
  }
}
