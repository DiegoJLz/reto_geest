import { DomainException } from './domain.exception';

export class ConflictException extends DomainException {
  constructor(code: string, message: string) {
    super('CONFLICT', code, message);
    this.name = 'ConflictException';
  }
}
