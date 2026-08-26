import { DomainException } from './domain.exception';

export class NotFoundException extends DomainException {
  constructor(code: string, message: string) {
    super('NOT_FOUND', code, message);
    this.name = 'NotFoundException';
  }
}
