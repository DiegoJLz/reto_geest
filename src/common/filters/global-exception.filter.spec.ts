import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { ConflictException } from '../exceptions/conflict.exception';
import { NotFoundException } from '../exceptions/not-found.exception';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  const buildHost = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/test' }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('maps DomainException to its status + code/message body', () => {
    const { host, status, json } = buildHost();
    filter.catch(new NotFoundException('USER_NOT_FOUND', 'nope'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'USER_NOT_FOUND', message: 'nope' },
    });
  });

  it('maps ConflictException to 409', () => {
    const { host, status } = buildHost();
    filter.catch(new ConflictException('DUP', 'already there'), host);
    expect(status).toHaveBeenCalledWith(409);
  });

  it('maps class-validator BadRequestException to VALIDATION_ERROR with details', () => {
    const { host, status, json } = buildHost();
    const err = new BadRequestException({
      statusCode: 400,
      message: ['email must be a valid email address', 'name is required'],
      error: 'Bad Request',
    });
    filter.catch(err, host);
    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    // Machine-readable code from HTTP status; never "Bad Request" (audit M8/M9).
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(['email must be a valid email address', 'name is required']);
  });

  it('maps generic HttpException string response', () => {
    const { host, status, json } = buildHost();
    filter.catch(new HttpException('teapot', 418), host);
    expect(status).toHaveBeenCalledWith(418);
    expect(json).toHaveBeenCalledWith({ error: { code: 'ERROR', message: 'teapot' } });
  });

  it('maps unknown throwables to 500 INTERNAL_ERROR', () => {
    const { host, status, json } = buildHost();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });
  });
});
