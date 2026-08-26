import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = module.get(HealthController);
  });

  it('returns status ok', () => {
    const res = controller.health();
    expect(res.status).toBe('ok');
    expect(typeof res.uptime).toBe('number');
    expect(res.timestamp).toBeDefined();
  });
});
